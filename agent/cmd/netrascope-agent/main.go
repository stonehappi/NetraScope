package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/kardianos/service"
	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/mem"
	gopsutilnet "github.com/shirou/gopsutil/v4/net"
	_ "modernc.org/sqlite"
)

const (
	defaultServerURL = "http://localhost:5050/api/metrics"
	defaultInterval  = 10 * time.Second
	defaultTimeout   = 5 * time.Second
	flushLimit       = 100
)

type config struct {
	ServerURL string
	ServerID  string
	Token     string
	BufferDB  string
	Interval  time.Duration
	Timeout   time.Duration
}

type metricPacket struct {
	ServerID           string    `json:"serverId"`
	Timestamp          time.Time `json:"timestamp"`
	CPUUsagePct        float64   `json:"cpuUsagePct"`
	MemoryUsedBytes    uint64    `json:"memoryUsedBytes"`
	MemoryTotalBytes   uint64    `json:"memoryTotalBytes"`
	DiskUtilizationPct float64   `json:"diskUtilizationPct"`
	NetworkInBytesSec  int64     `json:"networkInBytesSec"`
}

type networkSample struct {
	BytesRecv uint64
	TakenAt   time.Time
}

type agentProgram struct {
	cfg    config
	cancel context.CancelFunc
	done   chan struct{}
	mu     sync.Mutex
}

type serviceLogWriter struct {
	logger service.Logger
}

func (w serviceLogWriter) Write(message []byte) (int, error) {
	err := w.logger.Info(strings.TrimSpace(string(message)))
	return len(message), err
}

func main() {
	cfg, serviceAction, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}

	serviceConfig := &service.Config{
		Name:        "netrascope-agent",
		DisplayName: "NetraScope Agent",
		Description: "Collects host performance metrics for NetraScope.",
		Arguments:   serviceArguments(cfg),
		Dependencies: []string{
			"After=network-online.target",
			"Wants=network-online.target",
		},
		Option: service.KeyValue{
			"KeepAlive":              true,
			"RunAtLoad":              true,
			"Restart":                "always",
			"StartType":              "automatic",
			"OnFailure":              "restart",
			"OnFailureDelayDuration": "5s",
			"DelayedAutoStart":       true,
			"LogOutput":              true,
		},
	}

	program := &agentProgram{cfg: cfg}
	systemService, err := service.New(program, serviceConfig)
	if err != nil {
		log.Fatalf("initialize system service: %v", err)
	}

	serviceLogger, err := systemService.Logger(nil)
	if err != nil {
		log.Fatalf("initialize service logger: %v", err)
	}
	log.SetOutput(serviceLogWriter{logger: serviceLogger})

	if serviceAction != "" {
		if err := controlService(systemService, serviceAction); err != nil {
			log.Fatal(err)
		}
		return
	}

	if err := systemService.Run(); err != nil {
		log.Fatal(err)
	}
}

func (p *agentProgram) Start(_ service.Service) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if err := os.MkdirAll(filepath.Dir(p.cfg.BufferDB), 0o750); err != nil {
		return fmt.Errorf("create buffer directory: %w", err)
	}

	db, err := openBuffer(p.cfg.BufferDB)
	if err != nil {
		return fmt.Errorf("initialize local buffer: %w", err)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	p.cancel = cancel
	p.done = make(chan struct{})

	go func() {
		defer close(p.done)
		defer cancel()
		defer db.Close()

		client := &http.Client{Timeout: p.cfg.Timeout}
		log.Printf("NetraScope agent started: server_id=%q interval=%s", p.cfg.ServerID, p.cfg.Interval)
		if err := run(ctx, p.cfg, db, client); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("agent stopped with error: %v", err)
		}
		log.Print("NetraScope agent stopped")
	}()

	return nil
}

func (p *agentProgram) Stop(_ service.Service) error {
	p.mu.Lock()
	cancel := p.cancel
	done := p.done
	p.mu.Unlock()

	if cancel == nil {
		return nil
	}
	cancel()

	select {
	case <-done:
	case <-time.After(p.cfg.Timeout + 2*time.Second):
		log.Print("timed out waiting for agent shutdown")
	}
	return nil
}

func loadConfig() (config, string, error) {
	hostname, err := os.Hostname()
	if err != nil {
		return config{}, "", fmt.Errorf("read hostname: %w", err)
	}

	defaultBuffer := defaultBufferPath()

	cfg := config{}
	var serviceAction string
	flag.StringVar(&cfg.ServerURL, "server-url", envOr("NETRASCOPE_SERVER_URL", defaultServerURL), "metrics ingestion endpoint")
	flag.StringVar(&cfg.ServerID, "server-id", envOr("NETRASCOPE_SERVER_ID", hostname), "unique server identifier")
	flag.StringVar(&cfg.Token, "token", os.Getenv("NETRASCOPE_TOKEN"), "optional bearer token")
	flag.StringVar(&cfg.BufferDB, "buffer-db", envOr("NETRASCOPE_BUFFER_DB", defaultBuffer), "SQLite offline buffer path")
	flag.DurationVar(&cfg.Interval, "interval", envDuration("NETRASCOPE_INTERVAL", defaultInterval), "metric collection interval")
	flag.DurationVar(&cfg.Timeout, "timeout", envDuration("NETRASCOPE_TIMEOUT", defaultTimeout), "HTTP request timeout")
	flag.StringVar(&serviceAction, "service", "", "service action: install, uninstall, start, stop, restart, or status")
	flag.Parse()

	serviceAction = strings.ToLower(strings.TrimSpace(serviceAction))
	if serviceAction == "install" && os.Getenv("NETRASCOPE_BUFFER_DB") == "" && !flagWasSet("buffer-db") {
		cfg.BufferDB = defaultServiceBufferPath()
	}

	cfg.ServerURL = strings.TrimSpace(cfg.ServerURL)
	cfg.ServerID = strings.TrimSpace(cfg.ServerID)
	if cfg.ServerURL == "" {
		return config{}, "", errors.New("server URL cannot be empty")
	}
	if cfg.ServerID == "" {
		return config{}, "", errors.New("server ID cannot be empty")
	}
	if cfg.Interval <= 0 {
		return config{}, "", errors.New("interval must be greater than zero")
	}
	if cfg.Timeout <= 0 {
		return config{}, "", errors.New("timeout must be greater than zero")
	}

	return cfg, serviceAction, nil
}

func serviceArguments(cfg config) []string {
	arguments := []string{
		"-server-url", cfg.ServerURL,
		"-server-id", cfg.ServerID,
		"-buffer-db", cfg.BufferDB,
		"-interval", cfg.Interval.String(),
		"-timeout", cfg.Timeout.String(),
	}
	if cfg.Token != "" {
		arguments = append(arguments, "-token", cfg.Token)
	}
	return arguments
}

func controlService(systemService service.Service, action string) error {
	switch action {
	case "install":
		if err := systemService.Install(); err != nil {
			return fmt.Errorf("install service: %w", err)
		}
		if err := systemService.Start(); err != nil {
			_ = systemService.Uninstall()
			return fmt.Errorf("start service after install; installation rolled back: %w", err)
		}
		if err := waitForServiceStatus(systemService, service.StatusRunning, 15*time.Second); err != nil {
			_ = systemService.Stop()
			_ = systemService.Uninstall()
			return fmt.Errorf("verify automatic service startup; installation rolled back: %w", err)
		}
		log.Print("NetraScope agent installed, enabled for automatic startup, and running")
		return nil
	case "uninstall":
		status, err := systemService.Status()
		if err == nil && status == service.StatusRunning {
			if err := systemService.Stop(); err != nil {
				return fmt.Errorf("stop service before uninstall: %w", err)
			}
		}
		if err := systemService.Uninstall(); err != nil {
			return fmt.Errorf("uninstall service: %w", err)
		}
		log.Print("NetraScope agent service uninstalled")
		return nil
	case "start", "stop", "restart":
		if err := service.Control(systemService, action); err != nil {
			return err
		}
		log.Printf("NetraScope agent service action completed: %s", action)
		return nil
	case "status":
		status, err := systemService.Status()
		if err != nil {
			return fmt.Errorf("read service status: %w", err)
		}
		log.Printf("NetraScope agent service status: %s", serviceStatusName(status))
		return nil
	default:
		return fmt.Errorf("unknown service action %q; use install, uninstall, start, stop, restart, or status", action)
	}
}

func waitForServiceStatus(systemService service.Service, expected service.Status, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		status, err := systemService.Status()
		if err == nil && status == expected {
			return nil
		}
		time.Sleep(250 * time.Millisecond)
	}
	return fmt.Errorf("service did not reach %s state within %s", serviceStatusName(expected), timeout)
}

func serviceStatusName(status service.Status) string {
	switch status {
	case service.StatusRunning:
		return "running"
	case service.StatusStopped:
		return "stopped"
	default:
		return "unknown"
	}
}

func run(ctx context.Context, cfg config, db *sql.DB, client *http.Client) error {
	previousNetwork, err := readNetworkSample()
	if err != nil {
		log.Printf("initial network sample unavailable: %v", err)
		previousNetwork = networkSample{TakenAt: time.Now()}
	}

	timer := time.NewTimer(0)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
			metric, nextNetwork, err := collectMetric(ctx, cfg.ServerID, previousNetwork)
			if err != nil {
				log.Printf("collect metrics: %v", err)
			} else {
				previousNetwork = nextNetwork
				flushOfflineData(ctx, db, client, cfg)
				if err := sendMetric(ctx, client, cfg, metric); err != nil {
					if queueErr := queueMetric(db, metric); queueErr != nil {
						log.Printf("send metric: %v; buffer metric: %v", err, queueErr)
					} else {
						log.Printf("send metric: %v; saved to offline buffer", err)
					}
				} else {
					log.Print("metric sent")
				}
			}
			timer.Reset(cfg.Interval)
		}
	}
}

func collectMetric(ctx context.Context, serverID string, previous networkSample) (metricPacket, networkSample, error) {
	memory, err := mem.VirtualMemoryWithContext(ctx)
	if err != nil {
		return metricPacket{}, previous, fmt.Errorf("memory: %w", err)
	}

	cpuPercent, err := cpu.PercentWithContext(ctx, time.Second, false)
	if err != nil {
		return metricPacket{}, previous, fmt.Errorf("cpu: %w", err)
	}
	if len(cpuPercent) == 0 {
		return metricPacket{}, previous, errors.New("cpu: no utilization sample returned")
	}

	diskUsage, err := disk.UsageWithContext(ctx, rootDiskPath())
	if err != nil {
		return metricPacket{}, previous, fmt.Errorf("disk: %w", err)
	}

	currentNetwork, err := readNetworkSample()
	if err != nil {
		return metricPacket{}, previous, fmt.Errorf("network: %w", err)
	}

	return metricPacket{
		ServerID:           serverID,
		Timestamp:          time.Now().UTC(),
		CPUUsagePct:        cpuPercent[0],
		MemoryUsedBytes:    memory.Used,
		MemoryTotalBytes:   memory.Total,
		DiskUtilizationPct: diskUsage.UsedPercent,
		NetworkInBytesSec:  networkReceiveRate(previous, currentNetwork),
	}, currentNetwork, nil
}

func rootDiskPath() string {
	if runtime.GOOS == "windows" {
		if drive := os.Getenv("SystemDrive"); drive != "" {
			return drive + `\`
		}
		return `C:\`
	}
	return "/"
}

func readNetworkSample() (networkSample, error) {
	counters, err := gopsutilnet.IOCounters(false)
	if err != nil {
		return networkSample{}, err
	}
	if len(counters) == 0 {
		return networkSample{}, errors.New("no network counters returned")
	}
	return networkSample{BytesRecv: counters[0].BytesRecv, TakenAt: time.Now()}, nil
}

func networkReceiveRate(previous, current networkSample) int64 {
	elapsed := current.TakenAt.Sub(previous.TakenAt).Seconds()
	if elapsed <= 0 || current.BytesRecv < previous.BytesRecv {
		return 0
	}
	return int64(float64(current.BytesRecv-previous.BytesRecv) / elapsed)
}

func openBuffer(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}

	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS metrics (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			payload TEXT NOT NULL,
			created_at TEXT NOT NULL
		);
	`); err != nil {
		db.Close()
		return nil, err
	}

	return db, nil
}

func queueMetric(db *sql.DB, metric metricPacket) error {
	payload, err := json.Marshal(metric)
	if err != nil {
		return err
	}
	_, err = db.Exec(
		"INSERT INTO metrics (payload, created_at) VALUES (?, ?)",
		string(payload),
		time.Now().UTC().Format(time.RFC3339Nano),
	)
	return err
}

func flushOfflineData(ctx context.Context, db *sql.DB, client *http.Client, cfg config) {
	rows, err := db.QueryContext(ctx, "SELECT id, payload FROM metrics ORDER BY id ASC LIMIT ?", flushLimit)
	if err != nil {
		log.Printf("read offline buffer: %v", err)
		return
	}

	type queuedMetric struct {
		ID      int64
		Payload []byte
	}
	var queued []queuedMetric
	for rows.Next() {
		var item queuedMetric
		if err := rows.Scan(&item.ID, &item.Payload); err != nil {
			log.Printf("scan offline metric: %v", err)
			continue
		}
		queued = append(queued, item)
	}
	if err := rows.Err(); err != nil {
		log.Printf("iterate offline buffer: %v", err)
	}
	rows.Close()

	for _, item := range queued {
		if err := sendPayload(ctx, client, cfg, item.Payload); err != nil {
			log.Printf("flush offline buffer: %v", err)
			return
		}
		if _, err := db.ExecContext(ctx, "DELETE FROM metrics WHERE id = ?", item.ID); err != nil {
			log.Printf("delete flushed metric: %v", err)
			return
		}
	}

	if len(queued) > 0 {
		log.Printf("flushed %d offline metrics", len(queued))
	}
}

func sendMetric(ctx context.Context, client *http.Client, cfg config, metric metricPacket) error {
	payload, err := json.Marshal(metric)
	if err != nil {
		return err
	}
	return sendPayload(ctx, client, cfg, payload)
}

func sendPayload(ctx context.Context, client *http.Client, cfg config, payload []byte) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.ServerURL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "NetraScope-Agent/1")
	if cfg.Token != "" {
		request.Header.Set("Authorization", "Bearer "+cfg.Token)
	}

	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64<<10))

	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("server returned %s", response.Status)
	}
	return nil
}

func defaultBufferPath() string {
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		// $HOME/$XDG_CACHE_HOME are typically unset when running as a
		// service under a dedicated account; fall back to a system path.
		return defaultServiceBufferPath()
	}
	return filepath.Join(cacheDir, "NetraScope", "agent_buffer.db")
}

func defaultServiceBufferPath() string {
	switch runtime.GOOS {
	case "windows":
		base := os.Getenv("ProgramData")
		if base == "" {
			base = `C:\ProgramData`
		}
		return filepath.Join(base, "NetraScope", "agent_buffer.db")
	case "darwin":
		return filepath.Join("/Library/Application Support", "NetraScope", "agent_buffer.db")
	default:
		return filepath.Join("/var/lib", "netrascope", "agent_buffer.db")
	}
}

func flagWasSet(name string) bool {
	found := false
	flag.Visit(func(item *flag.Flag) {
		if item.Name == name {
			found = true
		}
	})
	return found
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func envDuration(name string, fallback time.Duration) time.Duration {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		log.Fatalf("%s must be a valid duration: %v", name, err)
	}
	return parsed
}
