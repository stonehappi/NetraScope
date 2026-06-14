PRAGMA foreign_keys = ON;

CREATE TABLE users (
  Id TEXT PRIMARY KEY,
  Username TEXT NOT NULL UNIQUE,
  PasswordHash TEXT NOT NULL,
  CreatedAt TEXT NOT NULL,
  IngestionToken TEXT NOT NULL UNIQUE
);

CREATE TABLE servers (
  Id TEXT PRIMARY KEY,
  HostName TEXT NOT NULL,
  IpAddress TEXT,
  LastHeartbeatAt TEXT NOT NULL,
  OwnerUserId TEXT REFERENCES users (Id) ON DELETE SET NULL
);

CREATE INDEX IX_servers_OwnerUserId ON servers (OwnerUserId);

CREATE TABLE performance_metrics (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  ServerId TEXT NOT NULL REFERENCES servers (Id) ON DELETE CASCADE,
  Timestamp TEXT NOT NULL,
  CpuUsagePct REAL NOT NULL,
  MemoryUsedBytes INTEGER NOT NULL,
  MemoryTotalBytes INTEGER NOT NULL,
  DiskUtilizationPct REAL NOT NULL,
  NetworkInBytesSec INTEGER NOT NULL
);

CREATE INDEX IX_performance_metrics_ServerId_Timestamp
  ON performance_metrics (ServerId, Timestamp DESC);

CREATE TABLE tags (
  Name TEXT PRIMARY KEY
);

CREATE TABLE server_tags (
  ServerId TEXT NOT NULL REFERENCES servers (Id) ON DELETE CASCADE,
  TagName TEXT NOT NULL REFERENCES tags (Name) ON DELETE CASCADE,
  PRIMARY KEY (ServerId, TagName)
);

CREATE INDEX IX_server_tags_TagName ON server_tags (TagName);
