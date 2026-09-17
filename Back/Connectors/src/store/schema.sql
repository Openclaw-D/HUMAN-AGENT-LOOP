-- Connectors 存储 schema（PostgreSQL 16）。幂等可重复执行。
-- 每表均含 tenantId 作用域；时间统一 timestamptz。

CREATE TABLE IF NOT EXISTS inbox_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  seq BIGINT,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',          -- received|processed|quarantined|rejected
  replay_count INT NOT NULL DEFAULT 0,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS ingestion_checkpoints (
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  channel TEXT NOT NULL,                            -- archive|kf
  last_seq BIGINT NOT NULL DEFAULT 0,
  cursor TEXT,
  suspected_gaps INT NOT NULL DEFAULT 0,
  confirmed_gaps INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider, channel)
);

CREATE TABLE IF NOT EXISTS communication_threads (
  thread_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT,                                  -- 隔离期可空
  channel TEXT NOT NULL,                             -- wecom_archive|wecom_kf
  provider_thread_key TEXT NOT NULL,                 -- 企微外部联系人id/roomid
  quarantine TEXT,                                   -- null|unassigned|ambiguous
  warnings JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, channel, provider_thread_key)
);

CREATE TABLE IF NOT EXISTS communication_events (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT,
  thread_id TEXT NOT NULL REFERENCES communication_threads(thread_id),
  provider_event_id TEXT NOT NULL,
  provider_timestamp TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_type TEXT NOT NULL,                         -- wecom_archive_msg|wecom_kf_msg|...
  source_from TEXT,
  source_to JSONB,
  direction TEXT,                                    -- inbound|outbound
  kind TEXT NOT NULL,                                -- text|image|voice|video|file|agree|disagree|revoke|voiptext|send_fail|...
  body JSONB NOT NULL,
  completeness TEXT NOT NULL DEFAULT 'complete',     -- complete|attachment_pending|incomplete
  consent_refs JSONB NOT NULL DEFAULT '[]',
  audit JSONB NOT NULL DEFAULT '{}',
  UNIQUE (tenant_id, provider_event_id)
);

CREATE TABLE IF NOT EXISTS attachment_jobs (
  job_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  sdkfileid TEXT NOT NULL,
  media_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',            -- pending|downloading|done|failed
  bytes_downloaded BIGINT NOT NULL DEFAULT 0,
  is_finish BOOLEAN NOT NULL DEFAULT FALSE,
  retries INT NOT NULL DEFAULT 0,
  last_error TEXT,
  object_ref TEXT,
  sha256 TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS participant_bindings (
  binding_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  thread_scope TEXT,                                 -- null=全局, 或 thread_id 限定
  status TEXT NOT NULL DEFAULT 'active',             -- active|candidate|quarantined|revoked
  verified_by TEXT NOT NULL,
  consent_ref TEXT,
  evidence_refs JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_binding_scope ON participant_bindings (tenant_id, provider, provider_user_id, customer_id, (COALESCE(thread_scope, '')));

CREATE TABLE IF NOT EXISTS consent_records (
  consent_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  subject_type TEXT NOT NULL,                        -- customer_participant|employee
  subject_id TEXT NOT NULL,
  channel TEXT NOT NULL,                             -- wecom_archive|wecom_kf|video_session
  purposes JSONB NOT NULL,                           -- ["transcription","recording","image_analysis","model_processing","external_disclosure"]
  data_category TEXT NOT NULL,
  basis TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',             -- active|revoked|expired
  granted_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  source TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS diligence_sessions (
  session_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  source_mode TEXT NOT NULL DEFAULT 'real',          -- real|synthetic
  call_state TEXT NOT NULL DEFAULT 'created',        -- created|invited|connecting|live|reconnecting|ended
  recording_state TEXT NOT NULL DEFAULT 'not_requested', -- not_requested|pending|recording|gapped|finalizing|complete|failed
  recording_task_id TEXT,
  recording_incomplete BOOLEAN NOT NULL DEFAULT FALSE,
  recording_gap_open BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session_participants (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES diligence_sessions(session_id),
  participant_id TEXT NOT NULL,
  role TEXT NOT NULL,                                -- customer|expert|observer
  joined_at TIMESTAMPTZ,
  left_at TIMESTAMPTZ,
  device_status JSONB NOT NULL DEFAULT '{}',
  media_tracks JSONB NOT NULL DEFAULT '[]',
  network JSONB NOT NULL DEFAULT '{}',
  UNIQUE (session_id, participant_id)
);

CREATE TABLE IF NOT EXISTS session_tokens (
  jti TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  role TEXT NOT NULL,
  room_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_count INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS recording_files (
  file_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  session_id TEXT,
  file_name TEXT NOT NULL,
  track_type TEXT,
  media_id TEXT,
  start_ms BIGINT,
  end_ms BIGINT,
  object_ref TEXT,
  sha256 TEXT,
  size_bytes BIGINT,
  status TEXT NOT NULL DEFAULT 'declared',           -- declared|stored|missing
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, task_id, file_name)
);

CREATE TABLE IF NOT EXISTS recording_event_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  event_type INT NOT NULL,
  task_id TEXT,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, dedupe_key)
);

CREATE TABLE IF NOT EXISTS objects (
  object_ref TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  content_type TEXT,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence_artifacts (
  evidence_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  session_id TEXT,
  source_provider TEXT NOT NULL,
  provider_event_id TEXT,
  object_ref TEXT,
  sha256 TEXT,
  kind TEXT NOT NULL,                                -- media|document|transcript|screenshot|...
  captured_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  media_start_ms BIGINT,
  media_end_ms BIGINT,
  track TEXT,
  frame_region TEXT,
  consent_ref TEXT,
  verification_state TEXT NOT NULL DEFAULT 'unverified', -- unverified|partial|verified|incomplete
  completeness TEXT NOT NULL DEFAULT 'complete',     -- complete|incomplete|needs_followup
  source_group TEXT NOT NULL,
  derived_from TEXT,
  duplicate_of TEXT,
  same_source_flag TEXT,                             -- null|same_source|suspected_duplicate
  source_mode TEXT NOT NULL DEFAULT 'real',
  schema_version INT NOT NULL DEFAULT 1,
  trust JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 任务02 · B1/W02 口径化元数据（存量库幂等补列；新建库由上方定义直接包含）
ALTER TABLE evidence_artifacts ADD COLUMN IF NOT EXISTS period_from TIMESTAMPTZ;  -- 材料期间起
ALTER TABLE evidence_artifacts ADD COLUMN IF NOT EXISTS period_to TIMESTAMPTZ;    -- 材料期间止
ALTER TABLE evidence_artifacts ADD COLUMN IF NOT EXISTS currency TEXT;            -- 币种（ISO 4217）
ALTER TABLE evidence_artifacts ADD COLUMN IF NOT EXISTS unit TEXT;                -- 数值单位（元/万元/台…）
ALTER TABLE evidence_artifacts ADD COLUMN IF NOT EXISTS caliber TEXT;             -- 口径（收付/权责/含税/不含税）
ALTER TABLE evidence_artifacts ADD COLUMN IF NOT EXISTS page_from INT;            -- 页码范围起
ALTER TABLE evidence_artifacts ADD COLUMN IF NOT EXISTS page_to INT;              -- 页码范围止
ALTER TABLE evidence_artifacts ADD COLUMN IF NOT EXISTS uploader_ref TEXT;        -- 上传者（绑定/邀请/渠道）引用
ALTER TABLE evidence_artifacts ADD COLUMN IF NOT EXISTS upload_source TEXT;       -- customer_upload|employee|channel_callback
ALTER TABLE evidence_artifacts ADD COLUMN IF NOT EXISTS object_refs JSONB NOT NULL DEFAULT '[]'; -- 设备/场所锚定（W10）

-- 任务02 · B1/W01 分级邀请：商机触发后把客户主体、角色身份、上传范围、会话对应起来。
-- 邀请令牌原文不落库（只存 sha256）；一次有效；接受 ≠ 验证（candidate，操作者核验后才 active）。
CREATE TABLE IF NOT EXISTS intake_invitations (
  invitation_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,                         -- 客户主档由 A 唯一持有；此处只引用不合并
  session_id TEXT,                                   -- 可空：会话未建立时先进件
  role TEXT NOT NULL,                                -- customer_owner|plant_manager|customer_finance|customer_contact
  allowed_evidence_kinds JSONB NOT NULL,             -- 该身份获准上传的证据 kind 清单
  object_refs JSONB NOT NULL DEFAULT '[]',           -- 获准的材料对象锚定（空=不限定对象）
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',            -- pending|accepted|revoked|expired
  expires_at TIMESTAMPTZ NOT NULL,
  created_by TEXT NOT NULL,
  accepted_binding_id TEXT,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invitations_customer ON intake_invitations(tenant_id, customer_id, status);
ALTER TABLE intake_invitations ADD COLUMN IF NOT EXISTS accepted_binding_id TEXT;  -- 幂等保底
ALTER TABLE intake_invitations ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS evidence_observations (
  observation_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  artifact_id TEXT,
  session_id TEXT,
  obs_kind TEXT NOT NULL,                            -- transcription|ocr|vision
  segment_id TEXT NOT NULL,
  revision INT NOT NULL DEFAULT 1,
  state TEXT NOT NULL,                               -- provisional|final
  text TEXT NOT NULL,
  start_ms BIGINT,
  end_ms BIGINT,
  language TEXT,
  speaker TEXT NOT NULL DEFAULT 'unknown',
  quality TEXT,
  superseded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fact_assertions (
  fact_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  statement TEXT NOT NULL,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object_value TEXT NOT NULL,
  unit TEXT,
  from_observations JSONB NOT NULL DEFAULT '[]',
  from_artifacts JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'candidate',          -- candidate|stale|superseded|rejected_by_human
  stale_reason TEXT,
  superseded_by TEXT,
  correction_of TEXT,
  source_mode TEXT NOT NULL DEFAULT 'real',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 任务02 · W10 事实级对象/期间锚定：kind 相同但对象/期间不同的事实不能互相替代
ALTER TABLE fact_assertions ADD COLUMN IF NOT EXISTS object_ref TEXT;
ALTER TABLE fact_assertions ADD COLUMN IF NOT EXISTS period_from TIMESTAMPTZ;
ALTER TABLE fact_assertions ADD COLUMN IF NOT EXISTS period_to TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS fact_conflicts (
  conflict_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  fact_a TEXT NOT NULL,
  fact_b TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',                -- open|resolved_by_correction|resolved_by_human
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  seq BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  summary TEXT NOT NULL,
  payload_sha256 TEXT
);

CREATE TABLE IF NOT EXISTS retention_policies (
  tenant_id TEXT NOT NULL,
  data_category TEXT NOT NULL,
  retain_days INT NOT NULL,
  PRIMARY KEY (tenant_id, data_category)
);

CREATE TABLE IF NOT EXISTS legal_holds (
  hold_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS disposition_log (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  action TEXT NOT NULL,                              -- retained_by_hold|disposed|dispose_pending_approval
  approved_by TEXT,
  detail JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_events_thread ON communication_events(thread_id, provider_timestamp);
CREATE INDEX IF NOT EXISTS idx_artifacts_customer ON evidence_artifacts(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_inbox_status ON inbox_events(tenant_id, provider, status);
