package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

/*
Fırlatıcı / sunucu ayrımı — tasarımın kalbindeki hatanın düzeltmesi.

Chrome, native-messaging kanalı kapanan host SÜRECİNİ ÖLDÜRÜR. İlk tasarımda
Chrome'un başlattığı süreç sunucunun kendisiydi: SW el sıkışmayı alıp kanalı
kapattığı anda sunucu ölüyordu — health çağrısı yarışı kazanıp geçiyor, bir
saniye sonraki iş devri ölü sürece gidiyordu ("Failed to fetch", saha testi
yakaladı). "Tarayıcı kapansa da sürsün" vaadi de aynı sebeple imkânsızdı.

Doğru akış:
  Chrome → fırlatıcı (bu süreç, kanala bağlı, kısa ömürlü)
             ├─ sağlıklı bir sunucu ZATEN varsa: adresini bildirir, çıkar
             └─ yoksa: sunucuyu BAĞIMSIZ oturumda (setsid) başlatır,
                adresini bildirir, çıkar
  Sunucu → kanaldan bağımsız yaşar; boşta kalınca kendini kapatır.

Adres ~/.config'deki endpoint dosyasında durur (0600). Token'ı aynı kullanıcı
hesabındaki süreçler okuyabilir — tehdit modelimizde bu kabul edilir: aynı
hesapta çalışan kötü yazılım zaten her şeyi yapabilir; korunulan şey AĞ ve
DİĞER kullanıcılar.
*/

type endpoint struct {
	Port    int    `json:"port"`
	Token   string `json:"token"`
	PID     int    `json:"pid"`
	Version string `json:"version"`
	Dir     string `json:"dir"`
}

func endpointPath() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "ruu-helper", "endpoint.json"), nil
}

func readEndpoint() (*endpoint, error) {
	p, err := endpointPath()
	if err != nil {
		return nil, err
	}
	blob, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	var e endpoint
	if err := json.Unmarshal(blob, &e); err != nil {
		return nil, err
	}
	return &e, nil
}

func writeEndpoint(e endpoint) error {
	p, err := endpointPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	blob, _ := json.Marshal(e)
	return os.WriteFile(p, blob, 0o600)
}

func removeEndpoint() {
	if p, err := endpointPath(); err == nil {
		_ = os.Remove(p)
	}
}

// acquireLock is a best-effort O_EXCL file lock; returns the release func.
func acquireLock() (func(), error) {
	p, err := endpointPath()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return nil, err
	}
	lockPath := p + ".lock"
	// Bayat kilit (çökmüş fırlatıcı) 30 sn sonra devralınır
	if st, err2 := os.Stat(lockPath); err2 == nil && time.Since(st.ModTime()) > 30*time.Second {
		_ = os.Remove(lockPath)
	}
	f, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	_ = f.Close()
	return func() { _ = os.Remove(lockPath) }, nil
}

// probeEndpoint asks a recorded server whether it is actually alive.
func probeEndpoint(e *endpoint) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		fmt.Sprintf("http://127.0.0.1:%d/health", e.Port), nil)
	if err != nil {
		return false
	}
	req.Header.Set("Authorization", "Bearer "+e.Token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	_ = res.Body.Close()
	return res.StatusCode == http.StatusOK
}

// ensureServer returns a live endpoint, starting the detached server if needed.
//
// Kilit şart: SW'nin el sıkışması ile başka bir tetik (ör. ikinci profil)
// AYNI ANDA koşarsa ikisi de "sunucu yok" görüp ikişer sunucu başlatıyordu —
// saha testinde yaşandı. O_EXCL kilidi ilk geleni kurucu yapar; diğeri kısa
// bekleyip kurulanı kullanır.
func ensureServer(dir, origin string) (*endpoint, error) {
	if e, err := readEndpoint(); err == nil {
		if probeEndpoint(e) {
			return e, nil
		}
		removeEndpoint() // bayat kayıt — sunucu ölmüş
	}

	lock, err := acquireLock()
	if err != nil {
		// Kilidi alamadık: kuran başka bir fırlatıcı var — sonucunu bekle
		deadline := time.Now().Add(8 * time.Second)
		for time.Now().Before(deadline) {
			if e, err2 := readEndpoint(); err2 == nil && probeEndpoint(e) {
				return e, nil
			}
			time.Sleep(100 * time.Millisecond)
		}
		return nil, errors.New("başka fırlatıcı sunucuyu kuramadı")
	}
	defer lock()

	// Kilit altında bir kez daha bak — biz beklerken kurulmuş olabilir
	if e, err2 := readEndpoint(); err2 == nil && probeEndpoint(e) {
		return e, nil
	}

	self, err := os.Executable()
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(self, "-serve", "-dir", dir, "-origin", origin)
	cmd.Stdout = nil // sunucu adresi endpoint DOSYASINDAN okunur, pipe'a bağımlılık yok
	cmd.Stderr = nil
	detach(cmd)
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	// Bağımsız oturumda başladı; süreç nesnesini serbest bırak (zombi kalmasın)
	go func() { _, _ = cmd.Process.Wait() }()

	// Endpoint dosyası belirene kadar bekle (sunucu dinlemeye başlayınca yazar)
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if e, err := readEndpoint(); err == nil && e.PID == cmd.Process.Pid && probeEndpoint(e) {
			return e, nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return nil, errors.New("sunucu açılmadı")
}

// runLauncher is what Chrome actually starts: hand out the address, exit.
func runLauncher(dir, origin string) error {
	e, err := ensureServer(dir, origin)
	if err != nil {
		return err
	}
	return writeNativeMessage(os.Stdout, map[string]any{
		"port": e.Port, "token": e.Token, "version": e.Version, "dir": e.Dir,
	})
}

// originFromArgs finds the chrome-extension:// origin Chrome appends.
func originFromArgs(args []string) (string, bool) {
	for _, a := range args {
		if strings.HasPrefix(a, "chrome-extension://") {
			return strings.TrimSuffix(a, "/"), true
		}
	}
	return "", false
}
