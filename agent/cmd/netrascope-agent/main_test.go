package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
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

func TestNetworkReceiveRate(t *testing.T) {
	t.Parallel()

	start := time.Date(2026, time.June, 13, 12, 0, 0, 0, time.UTC)
	previous := networkSample{BytesRecv: 1000, TakenAt: start}
	current := networkSample{BytesRecv: 5000, TakenAt: start.Add(2 * time.Second)}

	if got, want := networkReceiveRate(previous, current), int64(2000); got != want {
		t.Errorf("networkReceiveRate = %d, want %d", got, want)
	}
}
