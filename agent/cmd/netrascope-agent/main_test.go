package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestSendMetric(t *testing.T) {
	t.Parallel()

	metric := metricPacket{
		ServerID:           "server-01",
		Timestamp:          time.Date(2026, time.June, 13, 12, 0, 0, 0, time.UTC),
		CPUUsagePct:        25.5,
		MemoryUsedBytes:    512,
		MemoryTotalBytes:   1024,
		DiskUtilizationPct: 40,
		NetworkInBytesSec:  2048,
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if got := request.Header.Get("Authorization"); got != "Bearer secret" {
			t.Errorf("Authorization header = %q", got)
		}

		var received metricPacket
		if err := json.NewDecoder(request.Body).Decode(&received); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if received != metric {
			t.Errorf("received metric = %#v, want %#v", received, metric)
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	cfg := config{ServerURL: server.URL, Token: "secret"}
	if err := sendMetric(context.Background(), server.Client(), cfg, metric); err != nil {
		t.Fatalf("sendMetric returned error: %v", err)
	}
}

func TestSendMetricRejectsNonSuccessStatus(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	cfg := config{ServerURL: server.URL}
	err := sendMetric(context.Background(), server.Client(), cfg, metricPacket{})
	if err == nil {
		t.Fatal("sendMetric returned nil for a non-success response")
	}
}

func TestSendMetricBatch(t *testing.T) {
	t.Parallel()

	metrics := []metricPacket{
		{
			ServerID:           "server-01",
			Timestamp:          time.Date(2026, time.June, 13, 12, 0, 0, 0, time.UTC),
			CPUUsagePct:        25.5,
			MemoryUsedBytes:    512,
			MemoryTotalBytes:   1024,
			DiskUtilizationPct: 40,
			NetworkInBytesSec:  2048,
		},
		{
			ServerID:           "server-01",
			Timestamp:          time.Date(2026, time.June, 13, 12, 0, 10, 0, time.UTC),
			CPUUsagePct:        35.5,
			MemoryUsedBytes:    768,
			MemoryTotalBytes:   1024,
			DiskUtilizationPct: 41,
			NetworkInBytesSec:  4096,
		},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		var received []metricPacket
		if err := json.NewDecoder(request.Body).Decode(&received); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if len(received) != len(metrics) {
			t.Fatalf("received %d metrics, want %d", len(received), len(metrics))
		}
		for index := range metrics {
			if received[index] != metrics[index] {
				t.Errorf("received[%d] = %#v, want %#v", index, received[index], metrics[index])
			}
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	payloads := make([]json.RawMessage, len(metrics))
	for index, metric := range metrics {
		payload, err := json.Marshal(metric)
		if err != nil {
			t.Fatalf("marshal metric: %v", err)
		}
		payloads[index] = payload
	}

	cfg := config{ServerURL: server.URL}
	if err := sendMetricBatch(context.Background(), server.Client(), cfg, payloads); err != nil {
		t.Fatalf("sendMetricBatch returned error: %v", err)
	}
}

func TestQueueMetric(t *testing.T) {
	t.Parallel()

	db, err := openBuffer(filepath.Join(t.TempDir(), "buffer.db"))
	if err != nil {
		t.Fatalf("openBuffer: %v", err)
	}
	defer db.Close()

	metric := metricPacket{
		ServerID:  "server-01",
		Timestamp: time.Date(2026, time.June, 13, 12, 0, 0, 0, time.UTC),
	}
	if err := queueMetric(db, metric); err != nil {
		t.Fatalf("queueMetric: %v", err)
	}

	var payload []byte
	if err := db.QueryRow("SELECT payload FROM metrics").Scan(&payload); err != nil {
		t.Fatalf("read queued payload: %v", err)
	}

	var queued metricPacket
	if err := json.Unmarshal(payload, &queued); err != nil {
		t.Fatalf("decode queued payload: %v", err)
	}
	if queued != metric {
		t.Errorf("queued metric = %#v, want %#v", queued, metric)
	}
}

func TestFlushOfflineDataDeletesAcceptedBatch(t *testing.T) {
	t.Parallel()

	db, err := openBuffer(filepath.Join(t.TempDir(), "buffer.db"))
	if err != nil {
		t.Fatalf("openBuffer: %v", err)
	}
	defer db.Close()

	for index := 0; index < 3; index++ {
		if err := queueMetric(db, metricPacket{
			ServerID:           "server-01",
			Timestamp:          time.Date(2026, time.June, 13, 12, 0, index, 0, time.UTC),
			CPUUsagePct:        float64(index),
			MemoryUsedBytes:    512,
			MemoryTotalBytes:   1024,
			DiskUtilizationPct: 40,
			NetworkInBytesSec:  2048,
		}); err != nil {
			t.Fatalf("queueMetric: %v", err)
		}
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		var received []metricPacket
		if err := json.NewDecoder(request.Body).Decode(&received); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if len(received) != 2 {
			t.Fatalf("received %d metrics, want one batch of 2", len(received))
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	cfg := config{ServerURL: server.URL, BatchSize: 2}
	if ok := flushOfflineData(context.Background(), db, server.Client(), cfg); !ok {
		t.Fatal("flushOfflineData returned false")
	}

	var remaining int
	if err := db.QueryRow("SELECT COUNT(*) FROM metrics").Scan(&remaining); err != nil {
		t.Fatalf("count metrics: %v", err)
	}
	if remaining != 1 {
		t.Fatalf("remaining metrics = %d, want 1", remaining)
	}
}

func TestFlushOfflineDataRetainsRejectedBatch(t *testing.T) {
	t.Parallel()

	db, err := openBuffer(filepath.Join(t.TempDir(), "buffer.db"))
	if err != nil {
		t.Fatalf("openBuffer: %v", err)
	}
	defer db.Close()

	if err := queueMetric(db, metricPacket{
		ServerID:           "server-01",
		Timestamp:          time.Date(2026, time.June, 13, 12, 0, 0, 0, time.UTC),
		CPUUsagePct:        25.5,
		MemoryUsedBytes:    512,
		MemoryTotalBytes:   1024,
		DiskUtilizationPct: 40,
		NetworkInBytesSec:  2048,
	}); err != nil {
		t.Fatalf("queueMetric: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "nope", http.StatusBadGateway)
	}))
	defer server.Close()

	cfg := config{ServerURL: server.URL, BatchSize: 10}
	if ok := flushOfflineData(context.Background(), db, server.Client(), cfg); ok {
		t.Fatal("flushOfflineData returned true for rejected batch")
	}

	var remaining int
	if err := db.QueryRow("SELECT COUNT(*) FROM metrics").Scan(&remaining); err != nil {
		t.Fatalf("count metrics: %v", err)
	}
	if remaining != 1 {
		t.Fatalf("remaining metrics = %d, want 1", remaining)
	}
}

func TestNetworkReceiveRate(t *testing.T) {
	t.Parallel()

	start := time.Date(2026, time.June, 13, 12, 0, 0, 0, time.UTC)
	previous := networkSample{BytesRecv: 1000, TakenAt: start}
	current := networkSample{BytesRecv: 5000, TakenAt: start.Add(2 * time.Second)}

	if got, want := networkReceiveRate(previous, current), int64(2000); got != want {
		t.Errorf("networkReceiveRate = %d, want %d", got, want)
	}
}

func TestServiceDependenciesAreLinuxOnly(t *testing.T) {
	t.Parallel()

	if dependencies := serviceDependencies("windows"); len(dependencies) != 0 {
		t.Fatalf("Windows dependencies = %v, want none", dependencies)
	}
	if dependencies := serviceDependencies("darwin"); len(dependencies) != 0 {
		t.Fatalf("macOS dependencies = %v, want none", dependencies)
	}

	dependencies := serviceDependencies("linux")
	if len(dependencies) != 2 {
		t.Fatalf("Linux dependencies = %v, want systemd network dependencies", dependencies)
	}
}

func TestReleaseAssetName(t *testing.T) {
	t.Parallel()

	tests := []struct {
		goos string
		arch string
		want string
	}{
		{goos: "linux", arch: "amd64", want: "netrascope-agent-linux-amd64"},
		{goos: "darwin", arch: "arm64", want: "netrascope-agent-darwin-arm64"},
		{goos: "windows", arch: "amd64", want: "netrascope-agent-windows-amd64.exe"},
	}

	for _, test := range tests {
		if got := releaseAssetName(test.goos, test.arch); got != test.want {
			t.Errorf("releaseAssetName(%q, %q) = %q, want %q", test.goos, test.arch, got, test.want)
		}
	}
}

func TestVersionTextIncludesPlatform(t *testing.T) {
	t.Parallel()

	text := versionText()
	if !strings.Contains(text, "netrascope-agent dev") {
		t.Fatalf("versionText() = %q, want agent name and dev version", text)
	}
	if !strings.Contains(text, runtime.GOOS+"/"+runtime.GOARCH) {
		t.Fatalf("versionText() = %q, want platform %s/%s", text, runtime.GOOS, runtime.GOARCH)
	}
}

func TestUpdateAgentReplacesDestinationFromURL(t *testing.T) {
	t.Parallel()

	const updatedBinary = "new agent binary"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if got := request.Header.Get("User-Agent"); got != "NetraScope-Agent/"+version {
			t.Errorf("User-Agent = %q", got)
		}
		_, _ = w.Write([]byte(updatedBinary))
	}))
	defer server.Close()

	destination := filepath.Join(t.TempDir(), "netrascope-agent")
	if err := os.WriteFile(destination, []byte("old agent binary"), 0o755); err != nil {
		t.Fatalf("write destination: %v", err)
	}

	if err := updateAgent(context.Background(), server.Client(), server.URL, destination); err != nil {
		t.Fatalf("updateAgent returned error: %v", err)
	}

	contents, err := os.ReadFile(destination)
	if err != nil {
		t.Fatalf("read updated destination: %v", err)
	}
	if string(contents) != updatedBinary {
		t.Fatalf("updated destination = %q, want %q", contents, updatedBinary)
	}

	info, err := os.Stat(destination)
	if err != nil {
		t.Fatalf("stat updated destination: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o755 {
		t.Fatalf("updated destination permissions = %v, want 0755", got)
	}
}

func TestUpdateAgentRejectsFailedDownload(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	destination := filepath.Join(t.TempDir(), "netrascope-agent")
	if err := os.WriteFile(destination, []byte("old agent binary"), 0o755); err != nil {
		t.Fatalf("write destination: %v", err)
	}

	err := updateAgent(context.Background(), server.Client(), server.URL, destination)
	if err == nil {
		t.Fatal("updateAgent returned nil for failed download")
	}
	if !strings.Contains(err.Error(), "503") {
		t.Fatalf("updateAgent error = %q, want status code", err)
	}

	contents, readErr := os.ReadFile(destination)
	if readErr != nil {
		t.Fatalf("read destination: %v", readErr)
	}
	if string(contents) != "old agent binary" {
		t.Fatalf("destination changed after failed update: %q", contents)
	}
}
