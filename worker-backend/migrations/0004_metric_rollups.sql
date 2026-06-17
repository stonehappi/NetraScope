-- Downsampled metric history. Raw samples in performance_metrics are pruned
-- after their retention window; rollups keep long-range charts cheap and fast.
CREATE TABLE metric_rollups (
  ServerId TEXT NOT NULL REFERENCES servers (Id) ON DELETE CASCADE,
  Granularity TEXT NOT NULL,
  BucketStart TEXT NOT NULL,
  CpuAvg REAL NOT NULL,
  CpuMax REAL NOT NULL,
  MemoryUsedAvg INTEGER NOT NULL,
  MemoryUsedMax INTEGER NOT NULL,
  MemoryTotalMax INTEGER NOT NULL,
  DiskAvg REAL NOT NULL,
  DiskMax REAL NOT NULL,
  NetworkInAvg INTEGER NOT NULL,
  NetworkInMax INTEGER NOT NULL,
  SampleCount INTEGER NOT NULL,
  PRIMARY KEY (ServerId, Granularity, BucketStart)
);

CREATE INDEX IX_metric_rollups_Granularity_BucketStart
  ON metric_rollups (Granularity, BucketStart);
