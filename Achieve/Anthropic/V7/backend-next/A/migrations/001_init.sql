-- V7 backend-next A · 001 初始schema（goal collaboration kernel）
-- 全部业务写命令与 outbox/audit/幂等表同事务；无业务数据初始化。

CREATE TABLE goal_templates (
  template_id     text PRIMARY KEY,
  version         int  NOT NULL,
  name            text NOT NULL,
  industry        text,
  roles           jsonb NOT NULL,   -- [{roleKey,title,isHumanRole}]
  goals           jsonb NOT NULL,   -- [{goalKey,title,description,responsibleRole,executorKind,acceptanceRole,decisionRole,inputEvidenceKinds,dependsOn,params}]
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  project_id       text PRIMARY KEY,
  template_id      text NOT NULL REFERENCES goal_templates(template_id),
  template_version int  NOT NULL,
  name             text NOT NULL,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','closed')),
  input_version    int  NOT NULL DEFAULT 1,   -- 项目级单调版本（证据提交/取代 +1；证据命令 expectedVersion 指向它）
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE evidence (
  evidence_id   text PRIMARY KEY,
  project_id    text NOT NULL REFERENCES projects(project_id),
  version       int  NOT NULL DEFAULT 1,
  kind          text NOT NULL,
  content       jsonb NOT NULL,
  sha256        text NOT NULL,
  supersedes    text,
  superseded_by text,
  input_version int  NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_evidence_project_kind ON evidence (project_id, kind);

CREATE TABLE goals (
  goal_id          text PRIMARY KEY,
  project_id       text NOT NULL REFERENCES projects(project_id),
  goal_key         text NOT NULL,
  title            text NOT NULL,
  responsible_role text NOT NULL,
  executor_kind    text NOT NULL CHECK (executor_kind IN ('agent','human')),
  acceptance_role  text NOT NULL,
  decision_role    text NOT NULL,
  params           jsonb NOT NULL DEFAULT '{}'::jsonb,
  depends_on       jsonb NOT NULL DEFAULT '[]'::jsonb,     -- 已解析实例 goalId 数组
  input_evidence_kinds jsonb NOT NULL DEFAULT '[]'::jsonb,  -- 模板声明的就绪所需证据 kind（实例化时拷贝）
  input_evidence   jsonb NOT NULL DEFAULT '[]'::jsonb,     -- [{evidenceId,version}]
  input_hash       text,
  status           text NOT NULL DEFAULT 'blocked',
  version          int  NOT NULL DEFAULT 1,                 -- 乐观锁
  stale            boolean NOT NULL DEFAULT false,          -- accepted 后证据被取代的读投影
  result           jsonb,                                    -- 候选结果 authority=none
  formal_decision  jsonb,                                    -- 正式人工决定（decided 时非空）
  receipt_count    int  NOT NULL DEFAULT 0,
  assigned_to      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, goal_key)
);
CREATE INDEX idx_goals_project ON goals (project_id);

CREATE TABLE task_assignments (
  goal_id       text PRIMARY KEY REFERENCES goals(goal_id),
  assignee      text NOT NULL,
  kind          text NOT NULL,
  lease_until   timestamptz NOT NULL,
  fencing_token bigint NOT NULL,
  claimed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE human_requests (
  hrequest_id            text PRIMARY KEY,
  project_id             text NOT NULL REFERENCES projects(project_id),
  goal_id                text REFERENCES goals(goal_id),
  kind                   text NOT NULL CHECK (kind IN ('missing_evidence','decision','clarification')),
  question               text NOT NULL,
  requested_role         text NOT NULL,
  required_evidence_kinds jsonb NOT NULL DEFAULT '[]'::jsonb,
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','cancelled')),
  answer                 jsonb,
  created_by             text,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_hreq_project ON human_requests (project_id);

CREATE TABLE execution_receipts (
  receipt_id         text PRIMARY KEY,
  goal_id            text NOT NULL REFERENCES goals(goal_id),
  kind               text NOT NULL CHECK (kind IN ('claimed','execution_completed','execution_failed')),
  actor_principal_id text NOT NULL,
  fencing_token      bigint,
  output             jsonb,
  note               text,
  at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_receipts_goal ON execution_receipts (goal_id);

CREATE TABLE audit_events (
  seq                bigserial PRIMARY KEY,
  at                 timestamptz NOT NULL DEFAULT now(),
  actor_principal_id text,
  action             text NOT NULL,
  target_type        text NOT NULL,
  target_id          text NOT NULL,
  project_id         text,
  summary            text NOT NULL,
  payload_sha256     text NOT NULL
);

CREATE TABLE outbox_events (
  seq            bigserial PRIMARY KEY,
  event_id       uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  at             timestamptz NOT NULL DEFAULT now(),
  event_type     text NOT NULL,
  project_id     text,
  goal_id        text,
  payload        jsonb NOT NULL,
  dispatch_state text NOT NULL DEFAULT 'pending' CHECK (dispatch_state IN ('pending','delivered','dead')),
  attempts       int NOT NULL DEFAULT 0,
  last_error     text
);
CREATE INDEX idx_outbox_pending ON outbox_events (dispatch_state, seq);

CREATE TABLE subscriptions (
  sub_id     text PRIMARY KEY,
  name       text NOT NULL,
  url        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 每个 subscription 独立投递簿（at-least-once；按 (sub_id, seq) 重投直到 2xx）
CREATE TABLE outbox_deliveries (
  sub_id     text NOT NULL REFERENCES subscriptions(sub_id),
  seq        bigint NOT NULL REFERENCES outbox_events(seq),
  state      text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','delivered','dead')),
  attempts   int NOT NULL DEFAULT 0,
  last_error text,
  last_at    timestamptz,
  PRIMARY KEY (sub_id, seq)
);

CREATE TABLE idempotency (
  request_id     text PRIMARY KEY,
  payload_sha256 text NOT NULL,
  response       jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
