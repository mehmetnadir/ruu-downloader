package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// JobSpec is what the extension sends. Note what is NOT here: no strategy, no
// retry policy, no "work out the best settings". The extension decided all of
// that and passes the result. That asymmetry is the whole design — it is why
// this binary can stay still while the extension keeps getting smarter.
type JobSpec struct {
	ID          string            `json:"id"`
	URL         string            `json:"url"`
	Headers     map[string]string `json:"headers,omitempty"`
	Dest        string            `json:"dest"`        // dosya adı; indirme dizini altına yazılır
	Size        int64             `json:"size"`        // extension'ın probe'undan
	Connections int               `json:"connections"` // extension'ın rampası belirledi
	MinChunk    int64             `json:"minChunk,omitempty"`
}

type JobStatus struct {
	ID         string  `json:"id"`
	State      string  `json:"state"` // running | done | error | cancelled
	Size       int64   `json:"size"`
	Downloaded int64   `json:"downloaded"`
	Ranges     []Range `json:"ranges"`
	Error      string  `json:"error,omitempty"`
	Path       string  `json:"path,omitempty"`
}

type Job struct {
	spec   JobSpec
	mu     sync.Mutex
	ranges []Range
	state  string
	errMsg string
	path   string
	cancel context.CancelFunc
	file   *os.File
}

const journalSuffix = ".ruupart"

func (j *Job) status() JobStatus {
	j.mu.Lock()
	defer j.mu.Unlock()
	rs := append([]Range{}, j.ranges...)
	return JobStatus{
		ID: j.spec.ID, State: j.state, Size: j.spec.Size,
		Downloaded: Downloaded(rs), Ranges: rs, Error: j.errMsg, Path: j.path,
	}
}

func (j *Job) ack(r Range) {
	j.mu.Lock()
	j.ranges = MergeRange(j.ranges, r)
	j.mu.Unlock()
}

// saveJournal writes the acknowledged ranges next to the file.
//
// Order matters, and it is the same rule the extension learned the hard way:
// the journal claims bytes are ON DISK. Sync the data first, or a crash leaves
// the journal ahead of reality and the resumed file is silently corrupt.
func (j *Job) saveJournal() {
	j.mu.Lock()
	rs := append([]Range{}, j.ranges...)
	f, path := j.file, j.path
	j.mu.Unlock()
	if f == nil || path == "" {
		return
	}
	if err := f.Sync(); err != nil {
		return // flush edilemediyse yazma — yalan söylemektense sus
	}
	blob, err := json.Marshal(journalFile{j.spec.Size, j.spec.URL, rs})
	if err != nil {
		return
	}
	_ = os.WriteFile(path+journalSuffix, blob, 0o600)
}

type journalFile struct {
	Size   int64   `json:"size"`
	URL    string  `json:"url"`
	Ranges []Range `json:"ranges"`
}

func (j *Job) loadJournal() {
	j.mu.Lock()
	path := j.path
	j.mu.Unlock()
	blob, err := os.ReadFile(path + journalSuffix)
	if err != nil {
		return
	}
	var saved journalFile
	if json.Unmarshal(blob, &saved) != nil {
		return
	}
	// Boyut ya da URL değiştiyse eski ilerleme GEÇERSİZ — sıfırdan başla.
	if saved.Size != j.spec.Size || saved.URL != j.spec.URL {
		return
	}
	// Savunma: gerçek dosya boyutunu aşan aralıkları kırp (defter ileride kalmış olabilir).
	st, err := os.Stat(path)
	if err != nil {
		return
	}
	var safe []Range
	for _, r := range saved.Ranges {
		if r.Start >= st.Size() {
			continue
		}
		if r.End > st.Size() {
			r.End = st.Size()
		}
		if r.Len() > 0 {
			safe = MergeRange(safe, r)
		}
	}
	// KİLİT ŞART: status() aynı anda kilitli okuyor — kilitsiz yazım CI'ın
	// race detector'ında yakalandı (lokalde zamanlama tutmadı, CI'da tuttu).
	j.mu.Lock()
	j.ranges = safe
	j.mu.Unlock()
}

func (j *Job) run(ctx context.Context, dir string, client *http.Client) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	j.mu.Lock()
	j.cancel = cancel
	j.state = "running"
	j.path = filepath.Join(dir, j.spec.Dest)
	j.mu.Unlock()

	err := j.execute(ctx, client)
	j.mu.Lock()
	switch {
	case ctx.Err() != nil:
		j.state = "cancelled"
	case err != nil:
		j.state, j.errMsg = "error", err.Error()
	default:
		j.state = "done"
	}
	j.mu.Unlock()
}

func (j *Job) execute(ctx context.Context, client *http.Client) error {
	f, err := os.OpenFile(j.path, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return fmt.Errorf("dosya açılamadı: %w", err)
	}
	defer f.Close()
	j.mu.Lock()
	j.file = f
	j.mu.Unlock()

	j.loadJournal()
	if err := f.Truncate(j.spec.Size); err != nil {
		return fmt.Errorf("boyut ayrılamadı: %w", err)
	}

	minChunk := j.spec.MinChunk
	if minChunk <= 0 {
		minChunk = 1 << 20
	}
	conns := j.spec.Connections
	if conns < 1 {
		conns = 1
	}

	j.mu.Lock()
	missing := MissingRanges(j.ranges, j.spec.Size)
	j.mu.Unlock()
	if len(missing) == 0 {
		return j.finish(f)
	}

	// Defteri düzenli aralıklarla yaz: her ack'te yazmak fsync fırtınası olur.
	stop := make(chan struct{})
	var ticker sync.WaitGroup
	ticker.Add(1)
	go func() {
		defer ticker.Done()
		t := time.NewTicker(2 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				j.saveJournal()
			case <-stop:
				return
			case <-ctx.Done():
				return
			}
		}
	}()
	// DİKKAT: bitince defteri YENİDEN YAZMA. finish() onu siler; buradaki
	// gecikmeli yazma sildikten sonra çalışıp geri getiriyordu — tamamlanmış
	// bir dosyanın yanında "yarım" işareti bırakmak, bir sonraki açılışta
	// tamamlanmış işi yarım sanmak demek. (Test yakaladı.)
	defer func() {
		close(stop)
		ticker.Wait()
		j.mu.Lock()
		done := IsComplete(j.ranges, j.spec.Size)
		j.mu.Unlock()
		if !done {
			j.saveJournal()
		}
	}()

	work := SplitWork(missing, conns, minChunk)
	queue := make(chan Range, len(work))
	for _, r := range work {
		queue <- r
	}
	close(queue)

	var wg sync.WaitGroup
	errs := make(chan error, conns)
	for i := 0; i < conns; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for r := range queue {
				if ctx.Err() != nil {
					return
				}
				if err := j.fetchRange(ctx, client, f, r); err != nil {
					select {
					case errs <- err:
					default:
					}
					return
				}
			}
		}()
	}
	wg.Wait()
	close(errs)
	if err := <-errs; err != nil {
		return err
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return j.finish(f)
}

func (j *Job) fetchRange(ctx context.Context, client *http.Client, f *os.File, r Range) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, j.spec.URL, nil)
	if err != nil {
		return err
	}
	for k, v := range j.spec.Headers {
		req.Header.Set(k, v)
	}
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", r.Start, r.End-1))

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusPartialContent {
		return fmt.Errorf("beklenmedik durum %d", resp.StatusCode)
	}

	buf := make([]byte, 256*1024)
	offset := r.Start
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if offset+int64(n) > r.End {
				n = int(r.End - offset) // sunucu fazla yollarsa komşu aralığı ezmesin
			}
			if _, err := f.WriteAt(buf[:n], offset); err != nil {
				return fmt.Errorf("yazma hatası: %w", err)
			}
			// Aralık ancak YAZILDIKTAN sonra bildirilir.
			j.ack(Range{offset, offset + int64(n)})
			offset += int64(n)
		}
		if offset >= r.End {
			return nil
		}
		if readErr == io.EOF {
			return fmt.Errorf("erken EOF: %d/%d", offset-r.Start, r.Len())
		}
		if readErr != nil {
			return readErr
		}
	}
}

func (j *Job) finish(f *os.File) error {
	if err := f.Sync(); err != nil {
		return err
	}
	j.mu.Lock()
	complete := IsComplete(j.ranges, j.spec.Size)
	got := Downloaded(j.ranges)
	path := j.path
	j.mu.Unlock()
	if !complete {
		return fmt.Errorf("eksik: %d/%d bayt", got, j.spec.Size)
	}
	// İş bitti — yarım dosya defteri artık yalan olur, sil.
	_ = os.Remove(path + journalSuffix)
	return nil
}

func newClient() *http.Client {
	return &http.Client{
		Timeout: 0, // büyük dosyalar; kesinti context ile yönetilir
		Transport: &http.Transport{
			MaxIdleConnsPerHost:   64,
			ResponseHeaderTimeout: 30 * time.Second,
			DisableCompression:    true, // Range + gzip = bozuk offset
		},
	}
}
