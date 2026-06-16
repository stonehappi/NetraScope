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
	"strconv"
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
	defaultBatchSize = 6
	defaultFlush     = 60 * time.Second
	updateTimeout    = 2 * time.Minute
	flushLimit       = 100
)

var version = "dev"

type config struct {
	ServerURL string
	ServerID  string
	Token     string
	BufferDB  string
	Interval  time.Duration
	Timeout   time.Duration
	BatchSize int
	Flush     time.Duration
}

type commandOptions struct {
	ServiceAction string
	ShowVersion   bool
	Update        bool
	UpdateURL     string
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
	cfg, commands, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}

	if commands.ShowVersion {
		fmt.Println(versionText())
		return
	}

	if commands.Update {
		ctx, cancel := context.WithTimeout(context.Background(), updateTimeout)
		defer cancel()

		client := &http.Client{Timeout: updateTimeout}
		if err := updateAgent(ctx, client, commands.UpdateURL, ""); err != nil {
			log.Fatal(err)
		}
		log.Printf("NetraScope agent updated from %s", commands.UpdateURL)
		return
	}

	serviceConfig := &service.Config{
		Name:         "netrascope-agent",
		DisplayName:  "NetraScope Agent",
		Description:  "Collects host performance metrics for NetraScope.",
		Arguments:    serviceArguments(cfg),
		Dependencies: serviceDependencies(runtime.GOOS),
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

	if !service.Interactive() {
		serviceLogger, err := systemService.Logger(nil)
		if err != nil {
			log.Fatalf("initialize service logger: %v", err)
		}
		log.SetOutput(serviceLogWriter{logger: serviceLogger})
	}

	if commands.ServiceAction != "" {
		if err := controlService(systemService, commands.ServiceAction); err != nil {
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

func loadConfig() (config, commandOptions, error) {
	hostname, err := os.Hostname()
	if err != nil {
		return config{}, commandOptions{}, fmt.Errorf("read hostname: %w", err)
	}

	defaultBuffer := defaultBufferPath()

	cfg := config{}
	commands := commandOptions{}
	flag.StringVar(&cfg.ServerURL, "server-url", envOr("NETRASCOPE_SERVER_URL", defaultServerURL), "metrics ingestion endpoint")
	flag.StringVar(&cfg.ServerID, "server-id", envOr("NETRASCOPE_SERVER_ID", hostname), "unique server identifier")
	flag.StringVar(&cfg.Token, "token", os.Getenv("NETRASCOPE_TOKEN"), "optional bearer token")
	flag.StringVar(&cfg.BufferDB, "buffer-db", envOr("NETRASCOPE_BUFFER_DB", defaultBuffer), "SQLite offline buffer path")
	flag.DurationVar(&cfg.Interval, "interval", envDuration("NETRASCOPE_INTERVAL", defaultInterval), "metric collection interval")
	flag.DurationVar(&cfg.Timeout, "timeout", envDuration("NETRASCOPE_TIMEOUT", defaultTimeout), "HTTP request timeout")
	flag.IntVar(&cfg.BatchSize, "batch-size", envInt("NETRASCOPE_BATCH_SIZE", defaultBatchSize), "maximum locally buffered metrics sent in one request")
	flag.DurationVar(&cfg.Flush, "flush-interval", envDuration("NETRASCOPE_FLUSH_INTERVAL", defaultFlush), "maximum time between metric batch uploads")
	flag.StringVar(&commands.ServiceAction, "service", "", "service action: install, uninstall, start, stop, restart, or status")
	flag.BoolVar(&commands.ShowVersion, "version", false, "print the agent version and exit")
	flag.BoolVar(&commands.Update, "update", false, "download and install the latest agent release for this platform")
	flag.StringVar(&commands.UpdateURL, "update-url", defaultUpdateURL(), "agent binary URL used by -update")
	flag.Parse()

	commands.ServiceAction = strings.ToLower(strings.TrimSpace(commands.ServiceAction))
	commands.UpdateURL = strings.TrimSpace(commands.UpdateURL)
	if commands.ServiceAction == "install" && os.Getenv("NETRASCOPE_BUFFER_DB") == "" && !flagWasSet("buffer-db") {
		cfg.BufferDB = defaultServiceBufferPath()
	}

	cfg.ServerURL = strings.TrimSpace(cfg.ServerURL)
	cfg.ServerID = strings.TrimSpace(cfg.ServerID)
	if cfg.ServerURL == "" {
		return config{}, commandOptions{}, errors.New("server URL cannot be empty")
	}
	if cfg.ServerID == "" {
		return config{}, commandOptions{}, errors.New("server ID cannot be empty")
	}
	if cfg.Interval <= 0 {
		return config{}, commandOptions{}, errors.New("interval must be greater than zero")
	}
	if cfg.Timeout <= 0 {
		return config{}, commandOptions{}, errors.New("timeout must be greater than zero")
	}
	if cfg.BatchSize <= 0 {
		return config{}, commandOptions{}, errors.New("batch size must be greater than zero")
	}
	if cfg.Flush <= 0 {
		return config{}, commandOptions{}, errors.New("flush interval must be greater than zero")
	}
	if commands.Update && commands.UpdateURL == "" {
		return config{}, commandOptions{}, errors.New("update URL cannot be empty")
	}

	return cfg, commands, nil
}

func serviceArguments(cfg config) []string {
	arguments := []string{
		"-server-url", cfg.ServerURL,
		"-server-id", cfg.ServerID,
		"-buffer-db", cfg.BufferDB,
		"-interval", cfg.Interval.String(),
		"-timeout", cfg.Timeout.String(),
		"-batch-size", fmt.Sprint(cfg.BatchSize),
		"-flush-interval", cfg.Flush.String(),
	}
	if cfg.Token != "" {
		arguments = append(arguments, "-token", cfg.Token)
	}
	return arguments
}

func serviceDependencies(goos string) []string {
	if goos != "linux" {
		return nil
	}
	return []string{
		"After=network-online.target",
		"Wants=network-online.target",
	}
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
	var lastStatus service.Status
	var lastErr error
	for time.Now().Before(deadline) {
		status, err := systemService.Status()
		lastStatus = status
		lastErr = err
		if err == nil && status == expected {
			return nil
		}
		time.Sleep(250 * time.Millisecond)
	}
	if lastErr != nil {
		return fmt.Errorf(
			"service did not reach %s state within %s; last status check failed: %w",
			serviceStatusName(expected),
			timeout,
			lastErr,
		)
	}
	return fmt.Errorf(
		"service did not reach %s state within %s; last status was %s",
		serviceStatusName(expected),
		timeout,
		serviceStatusName(lastStatus),
	)
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

func versionText() string {
	return fmt.Sprintf("netrascope-agent %s (%s/%s)", version, runtime.GOOS, runtime.GOARCH)
}

func defaultUpdateURL() string {
	return "https://github.com/stonehappi/NetraScope/releases/latest/download/" + releaseAssetName(runtime.GOOS, runtime.GOARCH)
}

func releaseAssetName(goos, goarch string) string {
	name := fmt.Sprintf("netrascope-agent-%s-%s", goos, goarch)
	if goos == "windows" {
		name += ".exe"
	}
	return name
}

func updateAgent(ctx context.Context, client *http.Client, sourceURL, destinationPath string) error {
	if sourceURL == "" {
		return errors.New("update URL cannot be empty")
	}

	if destinationPath == "" {
		executable, err := currentExecutablePath()
		if err != nil {
			return err
		}
		destinationPath = executable
	}

	currentInfo, err := os.Stat(destinationPath)
	if err != nil {
		return fmt.Errorf("read current executable: %w", err)
	}
	if currentInfo.IsDir() {
		return fmt.Errorf("current executable path %q is a directory", destinationPath)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return fmt.Errorf("create update request: %w", err)
	}
	request.Header.Set("User-Agent", "NetraScope-Agent/"+version)

	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("download update: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64<<10))
		return fmt.Errorf("download update: server returned %s", response.Status)
	}

	destinationDir := filepath.Dir(destinationPath)
	tempFile, err := os.CreateTemp(destinationDir, filepath.Base(destinationPath)+".*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary update file: %w", err)
	}
	tempPath := tempFile.Name()
	removeTemp := true
	defer func() {
		if removeTemp {
			_ = os.Remove(tempPath)
		}
	}()

	written, copyErr := io.Copy(tempFile, response.Body)
	if copyErr != nil {
		_ = tempFile.Close()
		return fmt.Errorf("write temporary update file: %w", copyErr)
	}
	if written == 0 {
		_ = tempFile.Close()
		return errors.New("download update: response body was empty")
	}
	if err := tempFile.Chmod(currentInfo.Mode().Perm()); err != nil {
		_ = tempFile.Close()
		return fmt.Errorf("set update file permissions: %w", err)
	}
	if err := tempFile.Sync(); err != nil {
		_ = tempFile.Close()
		return fmt.Errorf("sync update file: %w", err)
	}
	if err := tempFile.Close(); err != nil {
		return fmt.Errorf("close update file: %w", err)
	}

	if runtime.GOOS == "windows" {
		if err := os.Remove(destinationPath); err != nil {
			removeTemp = false
			return fmt.Errorf("downloaded update to %s, but Windows could not replace the current executable; stop the service and replace it manually: %w", tempPath, err)
		}
	}

	if err := os.Rename(tempPath, destinationPath); err != nil {
		if runtime.GOOS == "windows" {
			removeTemp = false
			return fmt.Errorf("downloaded update to %s, but Windows could not replace the current executable; stop the service and replace it manually: %w", tempPath, err)
		}
		return fmt.Errorf("replace current executable: %w", err)
	}
	removeTemp = false
	return nil
}

func currentExecutablePath() (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("find current executable: %w", err)
	}
	resolved, err := filepath.EvalSymlinks(executable)
	if err == nil {
		return resolved, nil
	}
	return executable, nil
}

func run(ctx context.Context, cfg config, db *sql.DB, client *http.Client) error {
	previousNetwork, err := readNetworkSample()
	if err != nil {
		log.Printf("initial network sample unavailable: %v", err)
		previousNetwork = networkSample{TakenAt: time.Now()}
	}

	timer := time.NewTimer(0)
	defer timer.Stop()
	lastFlush := time.Now()

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
				if err := queueMetric(db, metric); err != nil {
					log.Printf("buffer metric: %v", err)
				} else {
					shouldFlush, err := shouldFlushOfflineData(db, cfg, lastFlush)
					if err != nil {
						log.Printf("inspect offline buffer: %v", err)
					} else if shouldFlush && flushOfflineData(ctx, db, client, cfg) {
						lastFlush = time.Now()
					}
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

func shouldFlushOfflineData(db *sql.DB, cfg config, lastFlush time.Time) (bool, error) {
	if time.Since(lastFlush) >= cfg.Flush {
		return true, nil
	}
	var queued int
	if err := db.QueryRow("SELECT COUNT(*) FROM metrics").Scan(&queued); err != nil {
		return false, err
	}
	return queued >= cfg.BatchSize, nil
}

func flushOfflineData(ctx context.Context, db *sql.DB, client *http.Client, cfg config) bool {
	limit := min(cfg.BatchSize, flushLimit)
	rows, err := db.QueryContext(ctx, "SELECT id, payload FROM metrics ORDER BY id ASC LIMIT ?", limit)
	if err != nil {
		log.Printf("read offline buffer: %v", err)
		return false
	}

	type queuedMetric struct {
		ID      int64
		Payload string
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

	if len(queued) == 0 {
		return true
	}

	payloads := make([]json.RawMessage, len(queued))
	for index, item := range queued {
		payloads[index] = json.RawMessage(item.Payload)
	}

	if err := sendMetricBatch(ctx, client, cfg, payloads); err != nil {
		log.Printf("flush metric batch: %v", err)
		return false
	}

	for _, item := range queued {
		if _, err := db.ExecContext(ctx, "DELETE FROM metrics WHERE id = ?", item.ID); err != nil {
			log.Printf("delete flushed metric: %v", err)
			return false
		}
	}

	log.Printf("flushed %d buffered metrics", len(queued))
	return true
}

func sendMetric(ctx context.Context, client *http.Client, cfg config, metric metricPacket) error {
	payload, err := json.Marshal(metric)
	if err != nil {
		return err
	}
	return sendPayload(ctx, client, cfg, payload)
}

func sendMetricBatch(ctx context.Context, client *http.Client, cfg config, metrics []json.RawMessage) error {
	payload, err := json.Marshal(metrics)
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
	request.Header.Set("User-Agent", "NetraScope-Agent/"+version)
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

func envInt(name string, fallback int) int {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		log.Fatalf("%s must be a valid integer: %v", name, err)
	}
	return parsed
}
