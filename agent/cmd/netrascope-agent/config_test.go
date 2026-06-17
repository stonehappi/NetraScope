package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadConfigFileParsesKnownKeys(t *testing.T) {
	path := writeConfig(t, `
# NetraScope agent config
server_url = "https://api.example.com/api/metrics"
token = 'secret-token'
interval = "30s"
server_id = web-01
batch_size = 12
`)

	values, err := loadConfigFile(path)
	if err != nil {
		t.Fatalf("loadConfigFile: %v", err)
	}

	want := map[string]string{
		"server_url": "https://api.example.com/api/metrics",
		"token":      "secret-token",
		"interval":   "30s",
		"server_id":  "web-01",
		"batch_size": "12",
	}
	for key, expected := range want {
		if values[key] != expected {
			t.Errorf("values[%q] = %q, want %q", key, values[key], expected)
		}
	}
}

func TestLoadConfigFileEmptyPath(t *testing.T) {
	values, err := loadConfigFile("")
	if err != nil {
		t.Fatalf("loadConfigFile: %v", err)
	}
	if len(values) != 0 {
		t.Errorf("expected empty map, got %v", values)
	}
}

func TestLoadConfigFileRejectsUnknownKey(t *testing.T) {
	path := writeConfig(t, "bogus_key = 1\n")
	if _, err := loadConfigFile(path); err == nil {
		t.Fatal("expected error for unknown key, got nil")
	}
}

func TestLoadConfigFileRejectsBadDuration(t *testing.T) {
	path := writeConfig(t, "interval = \"notaduration\"\n")
	if _, err := loadConfigFile(path); err == nil {
		t.Fatal("expected error for invalid duration, got nil")
	}
}

func TestLoadConfigFileRejectsMissingEquals(t *testing.T) {
	path := writeConfig(t, "server_url\n")
	if _, err := loadConfigFile(path); err == nil {
		t.Fatal("expected error for malformed line, got nil")
	}
}

func TestResolvePrecedence(t *testing.T) {
	const envName = "NETRASCOPE_TEST_INTERVAL"

	t.Run("env beats file and fallback", func(t *testing.T) {
		t.Setenv(envName, "45s")
		if got := resolveDuration(envName, "30s", time.Second); got != 45*time.Second {
			t.Errorf("got %v, want 45s", got)
		}
	})

	t.Run("file beats fallback when env unset", func(t *testing.T) {
		os.Unsetenv(envName)
		if got := resolveDuration(envName, "30s", time.Second); got != 30*time.Second {
			t.Errorf("got %v, want 30s", got)
		}
	})

	t.Run("fallback when env and file unset", func(t *testing.T) {
		os.Unsetenv(envName)
		if got := resolveString(envName, "", "fallback"); got != "fallback" {
			t.Errorf("got %q, want fallback", got)
		}
		if got := resolveInt(envName, "", 6); got != 6 {
			t.Errorf("got %d, want 6", got)
		}
	})
}

func writeConfig(t *testing.T, contents string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "agent.toml")
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}
