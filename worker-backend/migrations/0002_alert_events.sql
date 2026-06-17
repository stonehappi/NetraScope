CREATE TABLE alert_events (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  ServerId TEXT NOT NULL REFERENCES servers (Id) ON DELETE CASCADE,
  OwnerUserId TEXT REFERENCES users (Id) ON DELETE SET NULL,
  RuleKey TEXT NOT NULL,
  Severity TEXT NOT NULL,
  Status TEXT NOT NULL,
  Message TEXT NOT NULL,
  TriggerValue REAL,
  ThresholdValue REAL,
  TriggeredAt TEXT NOT NULL,
  LastObservedAt TEXT NOT NULL,
  ResolvedAt TEXT,
  LastNotifiedAt TEXT
);

CREATE INDEX IX_alert_events_OwnerUserId ON alert_events (OwnerUserId);
CREATE INDEX IX_alert_events_ServerId_RuleKey_Status
  ON alert_events (ServerId, RuleKey, Status);
CREATE INDEX IX_alert_events_LastObservedAt ON alert_events (LastObservedAt);
