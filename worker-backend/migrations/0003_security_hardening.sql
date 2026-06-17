CREATE TABLE agent_tokens (
  Id TEXT PRIMARY KEY,
  ServerId TEXT NOT NULL REFERENCES servers (Id) ON DELETE CASCADE,
  OwnerUserId TEXT NOT NULL REFERENCES users (Id) ON DELETE CASCADE,
  Name TEXT NOT NULL,
  TokenHash TEXT NOT NULL UNIQUE,
  TokenSuffix TEXT NOT NULL,
  AllowedIpAddresses TEXT,
  CreatedAt TEXT NOT NULL,
  LastUsedAt TEXT,
  RevokedAt TEXT
);

CREATE INDEX IX_agent_tokens_ServerId_OwnerUserId
  ON agent_tokens (ServerId, OwnerUserId);

CREATE INDEX IX_agent_tokens_OwnerUserId
  ON agent_tokens (OwnerUserId);

CREATE TABLE audit_logs (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  OwnerUserId TEXT REFERENCES users (Id) ON DELETE SET NULL,
  ActorType TEXT NOT NULL,
  Action TEXT NOT NULL,
  EntityType TEXT NOT NULL,
  EntityId TEXT,
  Message TEXT,
  IpAddress TEXT,
  CreatedAt TEXT NOT NULL
);

CREATE INDEX IX_audit_logs_OwnerUserId_CreatedAt
  ON audit_logs (OwnerUserId, CreatedAt DESC);
