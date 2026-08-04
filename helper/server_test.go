package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// rangeServer serves deterministic bytes with real Range semantics.
func rangeServer(t *testing.T, size int64) *httptest.Server {
	return rangeServerDelay(t, size, 0)
}

// rangeServerDelay adds a per-response delay so timing-dependent behaviour
// (cancel, pause) can be tested without racing a localhost server that would
// otherwise finish 40 MB in a few milliseconds.
func rangeServerDelay(t *testing.T, size int64, delay time.Duration) *httptest.Server {
	t.Helper()
	body := make([]byte, size)
	for i := range body {
		body[i] = byte(i % 251)
	}
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if delay > 0 {
			time.Sleep(delay)
		}
		rg := r.Header.Get("Range")
		if rg == "" {
			w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
			_, _ = w.Write(body)
			return
		}
		var start, end int64
		if _, err := fmt.Sscanf(rg, "bytes=%d-%d", &start, &end); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if end >= size {
			end = size - 1
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, size))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(body[start : end+1])
	}))
}

func newTestServer(t *testing.T) (*server, string) {
	t.Helper()
	dir := t.TempDir()
	return &server{
		token: "test-token", dir: dir, client: newClient(),
		jobs: map[string]*Job{}, ctx: context.Background(),
	}, dir
}

func do(t *testing.T, s *server, method, path, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	s.routes().ServeHTTP(rec, req)
	return rec
}

func TestAuthRequired(t *testing.T) {
	s, _ := newTestServer(t)
	for _, tok := range []string{"", "yanlış", "test-toke"} {
		if got := do(t, s, "GET", "/health", tok, "").Code; got != http.StatusUnauthorized {
			t.Fatalf("token %q ile %d döndü, 401 bekleniyordu", tok, got)
		}
	}
	if got := do(t, s, "GET", "/health", "test-token", "").Code; got != http.StatusOK {
		t.Fatalf("doğru token reddedildi: %d", got)
	}
}

func TestRefusesNonLoopbackBind(t *testing.T) {
	// Dışarıdan erişilebilir bir yardımcı = senin adına çalışan uzak indirme servisi
	for _, addr := range []string{"0.0.0.0:9000", "192.168.1.5:9000", "[::]:9000"} {
		if err := assertLoopback(addr); err == nil {
			t.Fatalf("%s kabul edildi — reddedilmeliydi", addr)
		}
	}
	for _, addr := range []string{"127.0.0.1:0", "localhost:8080", "[::1]:9000"} {
		if err := assertLoopback(addr); err != nil {
			t.Fatalf("%s reddedildi: %v", addr, err)
		}
	}
}

func TestSafeDestBlocksEscape(t *testing.T) {
	for _, bad := range []string{"../../etc/passwd", "/etc/passwd", `..\..\windows\x.exe`, "a/b/c.zip"} {
		got, err := safeDest(bad)
		if err != nil {
			continue
		}
		if strings.ContainsAny(got, `/\`) || got == ".." {
			t.Fatalf("%q → %q: dizin kaçışı geçti", bad, got)
		}
	}
	if got, _ := safeDest(".gizli"); got != "_.gizli" {
		t.Fatalf("gizli dosya adı korunmadı: %q", got)
	}
	if _, err := safeDest(""); err == nil {
		t.Fatal("boş dest kabul edildi")
	}
}

func TestRejectsNonHTTPScheme(t *testing.T) {
	s, _ := newTestServer(t)
	body := `{"id":"a","url":"file:///etc/passwd","dest":"x.bin","size":10}`
	if got := do(t, s, "POST", "/jobs", "test-token", body).Code; got != http.StatusBadRequest {
		t.Fatalf("file:// şeması kabul edildi: %d", got)
	}
}

func waitState(t *testing.T, s *server, id string, want string, limit time.Duration) JobStatus {
	t.Helper()
	deadline := time.Now().Add(limit)
	var st JobStatus
	for time.Now().Before(deadline) {
		rec := do(t, s, "GET", "/jobs/"+id, "test-token", "")
		_ = json.Unmarshal(rec.Body.Bytes(), &st)
		if st.State == want || st.State == "error" {
			return st
		}
		time.Sleep(20 * time.Millisecond)
	}
	return st
}

func TestParallelDownloadIsByteExact(t *testing.T) {
	const size = 3 << 20 // 3 MiB
	origin := rangeServer(t, size)
	defer origin.Close()
	s, dir := newTestServer(t)

	body := fmt.Sprintf(`{"id":"j1","url":%q,"dest":"out.bin","size":%d,"connections":8,"minChunk":65536}`,
		origin.URL, size)
	if got := do(t, s, "POST", "/jobs", "test-token", body).Code; got != http.StatusAccepted {
		t.Fatalf("iş başlatılamadı: %d", got)
	}
	st := waitState(t, s, "j1", "done", 20*time.Second)
	if st.State != "done" {
		t.Fatalf("iş bitmedi: %+v", st)
	}

	got, err := os.ReadFile(filepath.Join(dir, "out.bin"))
	if err != nil {
		t.Fatal(err)
	}
	want := make([]byte, size)
	for i := range want {
		want[i] = byte(i % 251)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("içerik bayt bayt eşleşmiyor (%d bayt indi)", len(got))
	}
	// Bitince yarım-dosya defteri kalmamalı
	if _, err := os.Stat(filepath.Join(dir, "out.bin"+journalSuffix)); !os.IsNotExist(err) {
		t.Fatal("defter silinmedi")
	}
}

func TestResumeFromJournal(t *testing.T) {
	const size = 1 << 20
	origin := rangeServer(t, size)
	defer origin.Close()
	s, dir := newTestServer(t)
	path := filepath.Join(dir, "resume.bin")

	// İlk yarısı zaten inmiş bir dosya + defteri hazırla
	half := int64(size / 2)
	pre := make([]byte, size)
	for i := int64(0); i < half; i++ {
		pre[i] = byte(i % 251)
	}
	if err := os.WriteFile(path, pre, 0o600); err != nil {
		t.Fatal(err)
	}
	blob, _ := json.Marshal(journalFile{size, origin.URL, []Range{{0, half}}})
	if err := os.WriteFile(path+journalSuffix, blob, 0o600); err != nil {
		t.Fatal(err)
	}

	body := fmt.Sprintf(`{"id":"j2","url":%q,"dest":"resume.bin","size":%d,"connections":4}`, origin.URL, size)
	do(t, s, "POST", "/jobs", "test-token", body)
	st := waitState(t, s, "j2", "done", 20*time.Second)
	if st.State != "done" {
		t.Fatalf("devam eden iş bitmedi: %+v", st)
	}
	got, _ := os.ReadFile(path)
	for i := range got {
		if got[i] != byte(i%251) {
			t.Fatalf("%d. baytta bozulma — devam yanlış hizalandı", i)
		}
	}
}

func TestJournalIgnoredWhenSizeChanged(t *testing.T) {
	// Sunucudaki dosya değiştiyse eski ilerleme GEÇERSİZ olmalı, yoksa
	// iki farklı sürüm birbirine karışır ve sessizce bozuk dosya üretir.
	dir := t.TempDir()
	path := filepath.Join(dir, "x.bin")
	_ = os.WriteFile(path, make([]byte, 100), 0o600)
	blob, _ := json.Marshal(journalFile{999, "http://eski", []Range{{0, 100}}})
	_ = os.WriteFile(path+journalSuffix, blob, 0o600)

	j := &Job{spec: JobSpec{Size: 100, URL: "http://yeni"}, path: path}
	j.loadJournal()
	if len(j.ranges) != 0 {
		t.Fatalf("uyumsuz defter kabul edildi: %v", j.ranges)
	}
}

func TestCancelKeepsPartialFile(t *testing.T) {
	const size = 4 << 20
	origin := rangeServerDelay(t, size, 800*time.Millisecond) // iptal penceresi
	defer origin.Close()
	s, dir := newTestServer(t)

	body := fmt.Sprintf(`{"id":"j3","url":%q,"dest":"part.bin","size":%d,"connections":2}`, origin.URL, size)
	do(t, s, "POST", "/jobs", "test-token", body)
	time.Sleep(120 * time.Millisecond) // sunucu hâlâ ilk cevabı bekletiyor
	do(t, s, "DELETE", "/jobs/j3", "test-token", "")
	st := waitState(t, s, "j3", "cancelled", 5*time.Second)
	if st.State != "cancelled" && st.State != "error" {
		t.Fatalf("iptal edilmedi: %+v", st)
	}
	// Kısmi dosya KORUNMALI — kullanıcı devam etmek isteyebilir
	if _, err := os.Stat(filepath.Join(dir, "part.bin")); err != nil {
		t.Fatalf("kısmi dosya silindi: %v", err)
	}
}

func TestDuplicateJobIDRejected(t *testing.T) {
	origin := rangeServer(t, 1<<20)
	defer origin.Close()
	s, _ := newTestServer(t)
	body := fmt.Sprintf(`{"id":"dup","url":%q,"dest":"a.bin","size":%d,"connections":1}`, origin.URL, 1<<20)
	do(t, s, "POST", "/jobs", "test-token", body)
	if got := do(t, s, "POST", "/jobs", "test-token", body).Code; got != http.StatusConflict {
		t.Fatalf("aynı id ikinci kez kabul edildi: %d", got)
	}
}

func TestConnectionsCapped(t *testing.T) {
	// Kullanıcıyı kaynak sunucuya saldırı aracına dönüştürmeyelim
	origin := rangeServer(t, 1<<20)
	defer origin.Close()
	s, _ := newTestServer(t)
	body := fmt.Sprintf(`{"id":"cap","url":%q,"dest":"c.bin","size":%d,"connections":5000}`, origin.URL, 1<<20)
	do(t, s, "POST", "/jobs", "test-token", body)
	s.mu.Lock()
	got := s.jobs["cap"].spec.Connections
	s.mu.Unlock()
	if got > 32 {
		t.Fatalf("bağlantı sayısı sınırlanmadı: %d", got)
	}
}
