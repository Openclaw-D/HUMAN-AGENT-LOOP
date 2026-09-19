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
-- goal-02 · IR-03-8② 人工事实进入四域分析输入的结构化溯源：
-- entry_mode ∈ NULL(机器解析默认)|manual_entry(人工转录)|correction(人工更正)——分析快照据此识别人工事实；
-- value_json=录入时的原始 JSON 值（布尔/数值类型保真，恢复时优先于 object_value 文本）。
ALTER TABLE fact_assertions ADD COLUMN IF NOT EXISTS entry_mode TEXT;
ALTER TABLE fact_assertions ADD COLUMN IF NOT EXISTS value_json JSONB;
-- 存量库幂等回填：旧人工录入行（结构化溯源列上线前）按 statement 前缀补标（只补 NULL，不改新行）
UPDATE fact_assertions SET entry_mode='manual_entry'
  WHERE entry_mode IS NULL AND statement LIKE '人工录入（%';

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

-- ============================================================================
-- goal-02 · 资料处理与尽调执行链（持久处理任务/解析缓存/四域预审结果/问题准备/成本）
-- 原则：传输/解压/解析/分析/核验进度分开持久化；中断后从 stage 游标恢复；
--       去重键含租户+客户+处理版本，不跨客户共用；预审结果=候选（authority=none）。
-- ============================================================================

-- 修正原件：声明取代关系（旧件保留不改写；下游材料集只取现行件）
ALTER TABLE evidence_artifacts ADD COLUMN IF NOT EXISTS superseded_by TEXT;

-- 持久处理任务：每登记一件材料一行；stage_cursor=下一待执行阶段
CREATE TABLE IF NOT EXISTS processing_tasks (
  task_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  depth INT NOT NULL DEFAULT 0,                     -- ZIP 解包深度（0=原件）
  status TEXT NOT NULL DEFAULT 'queued',            -- queued|running|done|failed|needs_followup|skipped_duplicate
  stage_cursor TEXT NOT NULL DEFAULT 'unzip',       -- unzip|parse|facts|analyze|questions|done
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  leased_until TIMESTAMPTZ,
  leased_by TEXT,
  failure_code TEXT,
  last_error TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, evidence_id)
);
CREATE INDEX IF NOT EXISTS idx_ptasks_due ON processing_tasks(status, leased_until);
CREATE INDEX IF NOT EXISTS idx_ptasks_customer ON processing_tasks(tenant_id, customer_id, status);

-- 阶段运行留痕：传输(HTTP 200)之外的解压/解析/事实/分析/提问/A登记逐段回执
CREATE TABLE IF NOT EXISTS processing_stage_runs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  stage TEXT NOT NULL,                              -- unzip|parse|facts|analyze|questions|register_a
  status TEXT NOT NULL,                             -- done|failed|skipped|skipped_duplicate|needs_followup|unknown
  attempt INT NOT NULL DEFAULT 1,
  detail JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  UNIQUE (task_id, stage, attempt)
);

-- 解析缓存：键=租户+客户+内容哈希+解析器版本（不跨客户共用）；同输入恒同产出
CREATE TABLE IF NOT EXISTS parse_results (
  parse_key TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  format TEXT,
  ok BOOLEAN NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_parse_sha ON parse_results(tenant_id, customer_id, sha256);

-- 四域预审域结果（候选，authority=none；键含输入哈希+规则版本+水位）
CREATE TABLE IF NOT EXISTS domain_analyses (
  analysis_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  input_hash TEXT NOT NULL,                         -- 域消费面签名（该域实际消费的事实键状态+规则版本），非全量快照哈希
  snapshot_hash TEXT,
  watermark_generation INT NOT NULL,
  ruleset_version TEXT NOT NULL,
  result JSONB NOT NULL,
  artifact_refs JSONB NOT NULL DEFAULT '[]',
  recomputed_because JSONB NOT NULL DEFAULT '[]',
  processed_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, customer_id, domain, input_hash, ruleset_version)
);

-- 四域收口（Gate/提问计划/金额候选/下一步）：同输入同规则=同收口（幂等复用）
CREATE TABLE IF NOT EXISTS analysis_finalizations (
  fin_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  watermark_generation INT NOT NULL,
  gate JSONB NOT NULL,
  question_plan JSONB NOT NULL,
  amount_candidate JSONB NOT NULL,
  next_step JSONB NOT NULL,
  artifact_refs JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, customer_id, input_hash, ruleset_version)
);

-- 问题准备（去重键=对象或事实|期间|目的|受众|回答权限；question_key 为其哈希）
CREATE TABLE IF NOT EXISTS prepared_questions (
  question_key TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  binding JSONB NOT NULL,
  tier TEXT NOT NULL,                               -- auto_outbound|human_gate
  status TEXT NOT NULL DEFAULT 'suggested',         -- suggested|queued_outbound|sent_ok|send_failed|send_unknown|needs_human|outbound_paused|material_received|answered|verified|cancelled
  dispatch_generation INT NOT NULL DEFAULT 0,
  basis_input_hash TEXT,
  stop_condition TEXT,
  target_fact TEXT,
  required_level TEXT,
  merged_from JSONB NOT NULL DEFAULT '[]',
  note TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, customer_id, question_key)
);

-- 成本台账：估算与实际分离；无账单 actual.billKnown=false（未知，不记 0）
CREATE TABLE IF NOT EXISTS processing_costs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  task_id TEXT,
  stage TEXT NOT NULL,
  estimate JSONB NOT NULL,
  actual JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 暂停旗标与派发代际（暂停=零新外发；在途单列）
CREATE TABLE IF NOT EXISTS processing_flags (
  flag_key TEXT PRIMARY KEY,                        -- 'tenant:<t>' | 'customer:<t>:<c>'
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  dispatch_generation INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- goal-02（产品交付·任务二）· A 桥接映射（跨服务 ID 持久化 + 幂等对账）
-- 原则：A 是业务事实与正式收口权威；Connectors 只保存引用与处理状态。
--       每条 A 操作一行登记：确定性 requestId + 原调用凭据（v2 回执按主体归属过滤，
--       对账必须用原 principal）+ 状态机（registered|unknown|failed）。
--       重放/恢复按 a_links 状态幂等续跑，绝不换 ID 重发。
-- ============================================================================

-- 客户↔A 客户持久映射（生产须来自授权客户目录/归集流程；配置仅可种子）
-- 任务02 受控映射链：linked_by ∈ config_seed|auto_authoritative_same_id|controlled_registration；
-- 链接必须经 A 权威核验（存在+租户归属，映射场景另附 legal_entity_ref 归属证明）后落库；
-- 禁止按文件名/企业同名/前缀推断（无此类代码路径）。
CREATE TABLE IF NOT EXISTS a_customer_links (
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  a_customer_id TEXT NOT NULL,
  project_id TEXT,
  linked_by TEXT NOT NULL DEFAULT 'config_seed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, customer_id)
);
ALTER TABLE a_customer_links ADD COLUMN IF NOT EXISTS legal_entity_ref TEXT;  -- 受控登记时的归属证明（A 档案一致才落）
ALTER TABLE a_customer_links ADD COLUMN IF NOT EXISTS verified_via TEXT;      -- 核验方式：a_get_customer（权威读）
ALTER TABLE a_customer_links ADD COLUMN IF NOT EXISTS linked_by_actor TEXT;   -- 受控登记请求操作者（留痕）

-- A 操作登记：entity_type ∈ material|derived|supersede|run|gate|finding|domain_result
CREATE TABLE IF NOT EXISTS a_links (
  link_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  task_id TEXT,
  entity_type TEXT NOT NULL,
  local_id TEXT NOT NULL,
  a_customer_id TEXT,
  a_ref TEXT,                                       -- aArtifactId | runId | receiptId | findingId
  request_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',           -- pending|registered|unknown|failed|skipped
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id)
);
CREATE INDEX IF NOT EXISTS idx_alinks_task ON a_links(tenant_id, task_id, status);
CREATE INDEX IF NOT EXISTS idx_alinks_local ON a_links(tenant_id, entity_type, local_id);
