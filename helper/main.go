// Ruu Helper — a dumb, ranged HTTP-to-disk pipe for the Ruu Downloader extension.
//
// It exists to do the two things a browser extension cannot: open more than six
// connections to one host (a Chromium constant), and keep downloading after the
// browser is closed. Everything else — how many connections, how to split, when
// to back off, what to name the file — is decided by the extension and passed in.
//
// Deliberately absent: auto-update, telemetry, crash reporting, any outbound
// request that is not a download the extension asked for.
package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

const version = "1.0.1"

type server struct {
	token  string
	origin string // yalnızca bu eklenti kaynağına CORS izni verilir
	dir    string
	client *http.Client
	mu     sync.Mutex
	jobs   map[string]*Job
	ctx    context.Context
	/** Son HTTP isteği — boşta kalma kapanışının saati. */
	lastReq atomicTime
}

type atomicTime struct {
	mu sync.Mutex
	t  time.Time
}

func (a *atomicTime) set(t time.Time) { a.mu.Lock(); a.t = t; a.mu.Unlock() }
func (a *atomicTime) get() time.Time  { a.mu.Lock(); defer a.mu.Unlock(); return a.t }

/** Boşta kalma sınırı: aktif iş yok + bu kadar süre istek yoksa sunucu kendini kapatır. */
const idleLimit = 15 * time.Minute

// startIdleWatch makes the detached server clean up after itself. A helper
// that lives forever after one download is a background process the user
// never asked to keep — self-termination is part of the trust story.
func (s *server) startIdleWatch(ctx context.Context, stop context.CancelFunc) {
	s.lastReq.set(time.Now())
	go func() {
		t := time.NewTicker(time.Minute)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.mu.Lock()
				busy := false
				for _, j := range s.jobs {
					if j.status().State == "running" {
						busy = true
						break
					}
				}
				s.mu.Unlock()
				if !busy && time.Since(s.lastReq.get()) > idleLimit {
					removeEndpoint()
					stop() // zarif kapanış — httpSrv.Shutdown tetiklenir
					return
				}
			}
		}
	}()
}

func main() {
	var (
		dir      = flag.String("dir", defaultDownloadDir(), "indirme dizini")
		addr     = flag.String("addr", "127.0.0.1:0", "dinlenecek adres (yalnız yerel)")
		handshake = flag.Bool("handshake", false, "fırlatıcı modu: sunucuyu garanti et, adresi stdio NM çerçevesiyle bildir, çık")
		serveMode = flag.Bool("serve", false, "sunucu modu (fırlatıcı başlatır; elle kullanma)")
		originArg = flag.String("origin", "", "izin verilecek eklenti kaynağı (normalde Chrome argüman olarak geçirir)")
		showVer  = flag.Bool("version", false, "sürümü yaz ve çık")
	)
	flag.Parse()
	if *showVer {
		fmt.Println("ruu-helper", version)
		return
	}

	// Dışarıya açılmayı kazara bile mümkün kılma: 127.0.0.1 dışında dinleme.
	if err := assertLoopback(*addr); err != nil {
		fmt.Fprintln(os.Stderr, "reddedildi:", err)
		os.Exit(2)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	tok := make([]byte, 32)
	if _, err := rand.Read(tok); err != nil {
		fmt.Fprintln(os.Stderr, "token üretilemedi:", err)
		os.Exit(1)
	}
	// Chrome, native-messaging ile başlattığı programa çağıran eklentinin
	// kaynağını argüman olarak geçirir. Bunu CORS'ta tam eşleşme olarak
	// kullanmak, host izni istemeye gerek bırakmıyor: tarayıcı cevabı başka
	// hiçbir kaynağa açmaz. Bir izin daha az = daha az sürtünme, daha küçük
	// inceleme yüzeyi.
	origin := *originArg
	// NM manifest'i argüman TAŞIYAMAZ — Chrome, çağıran eklentinin origin'ini
	// argv'ye kendisi ekler. Bu, "Chrome beni başlattı"nın işaretidir ve
	// FIRLATICI modunu otomatik açar. (Chrome, kanalı kapanan host sürecini
	// öldürür; sunucu bu yüzden ayrı, bağımsız bir süreçtir — bkz. launcher.go)
	if o, fromChrome := originFromArgs(flag.Args()); fromChrome {
		origin = o
		*handshake = true
	}
	if *handshake && !*serveMode {
		if err := runLauncher(*dir, origin); err != nil {
			fmt.Fprintln(os.Stderr, "fırlatıcı:", err)
			os.Exit(1)
		}
		return
	}
	srv := &server{
		token: hex.EncodeToString(tok), origin: origin, dir: *dir,
		client: newClient(), jobs: map[string]*Job{}, ctx: ctx,
	}
	if err := os.MkdirAll(srv.dir, 0o755); err != nil {
		fmt.Fprintln(os.Stderr, "indirme dizini oluşturulamadı:", err)
		os.Exit(1)
	}

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		fmt.Fprintln(os.Stderr, "dinlenemedi:", err)
		os.Exit(1)
	}
	port := ln.Addr().(*net.TCPAddr).Port

	if *serveMode {
		// Adres endpoint dosyasına yazılır; fırlatıcı ve sonraki fırlatıcılar
		// sunucuyu oradan bulur (tek sunucu, süreç birikmez).
		if err := writeEndpoint(endpoint{
			Port: port, Token: srv.token, PID: os.Getpid(), Version: version, Dir: srv.dir,
		}); err != nil {
			fmt.Fprintln(os.Stderr, "endpoint yazılamadı:", err)
			os.Exit(1)
		}
		defer removeEndpoint()
		srv.startIdleWatch(ctx, stop)
	} else {
		fmt.Printf("ruu-helper %s · http://127.0.0.1:%d · token: %s\n", version, port, srv.token)
	}

	httpSrv := &http.Server{Handler: srv.routes(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		sd, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(sd)
	}()
	if err := httpSrv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		fmt.Fprintln(os.Stderr, "sunucu hatası:", err)
		os.Exit(1)
	}
}

// assertLoopback refuses any bind address that is not loopback. A helper that
// can be reached from the network is a remote download service running as you.
func assertLoopback(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("adres çözümlenemedi: %w", err)
	}
	if host == "localhost" {
		return nil
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("yalnızca yerel adres dinlenebilir, verilen: %q", host)
	}
	return nil
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("OPTIONS /", s.preflight)
	mux.HandleFunc("GET /health", s.auth(s.health))
	mux.HandleFunc("GET /jobs", s.auth(s.listJobs))
	mux.HandleFunc("POST /jobs", s.auth(s.createJob))
	mux.HandleFunc("GET /jobs/{id}", s.auth(s.jobStatus))
	mux.HandleFunc("DELETE /jobs/{id}", s.auth(s.cancelJob))
	return s.cors(mux)
}

// cors allows exactly one origin: the extension Chrome told us about. Wildcards
// are refused on purpose — a helper that answers any origin is a download
// service any web page can drive.
func (s *server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.origin != "" && r.Header.Get("Origin") == s.origin {
			w.Header().Set("Access-Control-Allow-Origin", s.origin)
			w.Header().Set("Vary", "Origin")
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) preflight(w http.ResponseWriter, r *http.Request) {
	if s.origin == "" || r.Header.Get("Origin") != s.origin {
		http.Error(w, "kaynak reddedildi", http.StatusForbidden)
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", s.origin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE")
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	w.Header().Set("Access-Control-Max-Age", "600")
	// Private Network Access: Chrome, genel bir bağlamdan YEREL ağa yapılan
	// isteği ancak hedef bunu açıkça kabul ederse geçirir. Bu başlık olmadan
	// tarayıcı isteği preflight'ta sessizce düşürür — CORS doğru olsa bile.
	// (Saha testi bunu yakaladı: curl çalışıyordu, tarayıcı çalışmıyordu.)
	if r.Header.Get("Access-Control-Request-Private-Network") == "true" {
		w.Header().Set("Access-Control-Allow-Private-Network", "true")
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s.lastReq.set(time.Now())
		got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		// Sabit süreli karşılaştırma: token'ı bayt bayt tahmin ettirmeyelim.
		if subtle.ConstantTimeCompare([]byte(got), []byte(s.token)) != 1 {
			http.Error(w, "yetkisiz", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func (s *server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"version": version, "dir": s.dir,
		// Eklentinin neye güvenebileceğini bilmesi için yetenek bildirimi.
		"maxConnections": 32, "survivesBrowserClose": true, "resume": true,
	})
}

// listJobs lets the extension re-attach after the browser was closed and
// reopened. Without it a download that kept running would finish on disk but
// look abandoned in the panel — the feature would be half-delivered.
func (s *server) listJobs(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	out := make([]JobStatus, 0, len(s.jobs))
	for _, j := range s.jobs {
		out = append(out, j.status())
	}
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, out)
}

func (s *server) createJob(w http.ResponseWriter, r *http.Request) {
	var spec JobSpec
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&spec); err != nil {
		http.Error(w, "bozuk istek", http.StatusBadRequest)
		return
	}
	if spec.ID == "" || spec.URL == "" || spec.Size <= 0 {
		http.Error(w, "id, url ve size zorunlu", http.StatusBadRequest)
		return
	}
	if !isHTTPURL(spec.URL) {
		http.Error(w, "yalnızca http/https", http.StatusBadRequest)
		return
	}
	name, err := safeDest(spec.Dest)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	spec.Dest = name
	if spec.Connections > 32 {
		spec.Connections = 32 // üst sınır: kaynak sunucuya saldırıya dönüşmesin
	}

	s.mu.Lock()
	if _, dup := s.jobs[spec.ID]; dup {
		s.mu.Unlock()
		http.Error(w, "bu id zaten var", http.StatusConflict)
		return
	}
	job := &Job{spec: spec, state: "running"}
	s.jobs[spec.ID] = job
	s.mu.Unlock()

	go job.run(s.ctx, s.dir, s.client)
	writeJSON(w, http.StatusAccepted, job.status())
}

func (s *server) jobStatus(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	job := s.jobs[r.PathValue("id")]
	s.mu.Unlock()
	if job == nil {
		http.Error(w, "yok", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, job.status())
}

func (s *server) cancelJob(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	job := s.jobs[r.PathValue("id")]
	s.mu.Unlock()
	if job == nil {
		http.Error(w, "yok", http.StatusNotFound)
		return
	}
	job.mu.Lock()
	cancel := job.cancel
	job.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	// Yarım dosya ve defter KORUNUR: kullanıcı devam etmek isteyebilir.
	writeJSON(w, http.StatusOK, job.status())
}

// safeDest rejects anything that could write outside the download directory.
func safeDest(dest string) (string, error) {
	if dest == "" {
		return "", errors.New("dest zorunlu")
	}
	// Yol bileşenlerini tamamen at — yalnız dosya adı kabul edilir.
	name := filepath.Base(filepath.Clean("/" + strings.ReplaceAll(dest, "\\", "/")))
	if name == "." || name == ".." || name == string(filepath.Separator) {
		return "", errors.New("geçersiz dest")
	}
	if strings.HasPrefix(name, ".") {
		name = "_" + name // gizli dosya yazma
	}
	return name, nil
}

func isHTTPURL(u string) bool {
	return strings.HasPrefix(u, "http://") || strings.HasPrefix(u, "https://")
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// writeNativeMessage emits Chrome's native-messaging framing: a little-endian
// uint32 length followed by the JSON payload.
func writeNativeMessage(w io.Writer, v any) error {
	blob, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint32(len(blob))); err != nil {
		return err
	}
	_, err = w.Write(blob)
	return err
}

func defaultDownloadDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "."
	}
	return filepath.Join(home, "Downloads")
}
