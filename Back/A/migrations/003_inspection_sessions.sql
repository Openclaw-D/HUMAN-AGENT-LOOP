-- 任务一 · 联合尽调检查会话 schema（A1 边界）
-- 设计依据：Back/A/docs/INSPECTION_SESSION_V1.md §1–§2。
-- 原则：只新增对象；复用既有 projects/customers/outbox_events/audit_events/idempotency/evidence_artifacts；
--       检查会话不建平行"总状态表"——核验项/问题/外发/待办各自成行，收口状态从真实事项推导并落会话行。
--       迁移兼容既有客户/场所/会话/证据/额度 ID；旧数据不补造历史。

-- ============ 检查会话（运行状态与收口状态分离） ============
CREATE TABLE inspection_sessions (
  session_id          text PRIMARY KEY,
  project_id          text NOT NULL REFERENCES projects(project_id),
  customer_id         text NOT NULL REFERENCES customers(customer_id),
  tenant_id           text NOT NULL,
  site_id             text,                            -- 场所/站点引用（可为外部标识；本域不外键约束）
  title               text NOT NULL,
  run_status          text NOT NULL DEFAULT 'preparing'
                      CHECK (run_status IN ('preparing','ready','in_progress','suspended','ended')),
  closure_status      text NOT NULL DEFAULT 'open'
                      CHECK (closure_status IN ('open','pending_evidence','pending_review','ready_for_assessment','closed')),
  plan_version        int NOT NULL DEFAULT 1,          -- 会话内单调；每次计划修订 +1（含 scene/roles 变更）
  scene_version       text NOT NULL,                   -- 三维场景版本；恢复/重锚定一致性判据
  plan_snapshot       jsonb NOT NULL,                  -- {inspectionPlanVersion, intakeRef?, assessmentRef?, source}
  plan_snapshot_hash  text NOT NULL,                   -- sha256(规范化 plan_snapshot)
  roles               jsonb NOT NULL DEFAULT '[]'::jsonb, -- 名册 [{roleKey, kind:'human'|'agent'}]（可见范围+参与）
  participants        jsonb NOT NULL DEFAULT '{}'::jsonb, -- {roleKey: {present:boolean, since:iso}}
  owner_role          text NOT NULL,                   -- 推进会话的人类角色（pause/resume/end/takeover）
  outbound_paused     boolean NOT NULL DEFAULT false,
  dispatch_generation int NOT NULL DEFAULT 0,          -- 调度代际；pause 事务内 +1
  takeover_by         text,
  takeover_at         timestamptz,
  config              jsonb NOT NULL DEFAULT '{}'::jsonb, -- {maxFollowUpsPerQuestion, waitTimeoutSeconds, maxQuestionsPerItem}
  last_event_seq      bigint NOT NULL DEFAULT 0,       -- 最后业务事件游标（checkpoint/恢复用）
  closure_revision    int NOT NULL DEFAULT 0,          -- 会后补证 → +1 新修订
  version             int NOT NULL DEFAULT 1,          -- 乐观锁
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_inspections_project ON inspection_sessions (project_id);
CREATE INDEX idx_inspections_customer ON inspection_sessions (customer_id);

-- ============ 核验项（口述/材料/核实三段分离） ============
CREATE TABLE inspection_items (
  item_id            text PRIMARY KEY,
  session_id         text NOT NULL REFERENCES inspection_sessions(session_id),
  item_key           text NOT NULL,
  title              text NOT NULL,
  required           boolean NOT NULL DEFAULT true,
  responsible_role   text NOT NULL,                    -- 谁核验
  target_role        text NOT NULL,                    -- 向谁问/谁回答
  requires_human_verification boolean NOT NULL DEFAULT true,  -- 真人关键核验不得交给 Agent 冒充
  expected_evidence_kinds jsonb NOT NULL DEFAULT '[]'::jsonb, -- 必需材料 kind（evidence_artifacts.kind）
  object_ref         text,                             -- 对象/设备锚定（scene 对象标识）
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','waiting_answer','answered','waiting_evidence',
                                       'to_verify','verified','conflict','deferred','stale_review')),
  assigned_role      text,                             -- 当前负责人（改派只在此字段内发生，权限内）
  detail             jsonb NOT NULL DEFAULT '{}'::jsonb, -- {whyNeeded, expectedEvidence, stopCondition}
  anchors            jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{objectRef, sceneVersion, boundAt}] 历史保留，不覆盖
  verified_at        timestamptz,
  verified_by        text,
  version            int NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, item_key)
);
CREATE INDEX idx_insitems_session ON inspection_items (session_id, status);

-- ============ 问题/回答（去重：对象|期间|目的|受众|回答权限 相同才视为同一问） ============
CREATE TABLE inspection_questions (
  question_id    text PRIMARY KEY,
  session_id     text NOT NULL REFERENCES inspection_sessions(session_id),
  item_id        text REFERENCES inspection_items(item_id),
  dedup_key      text NOT NULL,                        -- sha256(objectRef|period|purpose|audience|target_role)
  audience       text NOT NULL CHECK (audience IN ('customer','internal')),
  target_role    text NOT NULL,
  requires_human boolean NOT NULL DEFAULT true,        -- 真人关键核验不得由 Agent 代答
  question       text NOT NULL,
  purpose        text NOT NULL DEFAULT 'clarify',
  period         text,
  object_ref     text,
  fact_key       text,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','sent','answered','closed')),
  follow_up_count int NOT NULL DEFAULT 0,
  answer         jsonb,                                -- {text, evidenceRefs:[artifactId], conflict, answeredBy, answeredAt}
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  answered_at    timestamptz
);
-- 同一会话内：对象/期间/目的/受众/回答权限完全相同的开放问题至多一条（去重）；已答/关闭后可再问（保留差异）
CREATE UNIQUE INDEX uq_insquestions_open ON inspection_questions (session_id, dedup_key)
  WHERE status IN ('open','sent');
CREATE INDEX idx_insquestions_session ON inspection_questions (session_id, status);

-- ============ 外发授权与在途（发送控制点；generation 校验） ============
CREATE TABLE inspection_outbound (
  send_id     text PRIMARY KEY,
  session_id  text NOT NULL REFERENCES inspection_sessions(session_id),
  question_id text REFERENCES inspection_questions(question_id),
  generation  int NOT NULL,                            -- 授权时的调度代际
  request_id  text NOT NULL,
  channel     text NOT NULL,
  status      text NOT NULL DEFAULT 'authorized'
              CHECK (status IN ('authorized','sent','unknown','cancelled','cancel_unsupported')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resulted_at timestamptz
);
CREATE INDEX idx_insoutbound_session ON inspection_outbound (session_id, status);

-- ============ 会后待办（每事项至多一条 open；超等待/追问边界只转一次） ============
CREATE TABLE inspection_followups (
  followup_id      text PRIMARY KEY,
  session_id       text NOT NULL REFERENCES inspection_sessions(session_id),
  item_id          text REFERENCES inspection_items(item_id),
  owner_role       text NOT NULL,
  reason           text NOT NULL,
  next_action      text NOT NULL,
  closure_revision int NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz
);
CREATE UNIQUE INDEX uq_insfollowups_open_per_item ON inspection_followups (session_id, item_id)
  WHERE status = 'open' AND item_id IS NOT NULL;

-- ============ 检查小结（按 closure_revision 固化；历史不改写） ============
CREATE TABLE inspection_summaries (
  summary_id       text PRIMARY KEY,
  session_id       text NOT NULL REFERENCES inspection_sessions(session_id),
  closure_revision int NOT NULL,
  audience         text NOT NULL CHECK (audience IN ('internal','customer')),
  content          jsonb NOT NULL,                     -- 结构化投影（真实事项/问题/待办；非模型自述）
  basis            text NOT NULL DEFAULT 'projection_from_tasks',
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, closure_revision, audience)
);

-- ============ checkpoint（暂停/结束/手动；媒体只存引用） ============
CREATE TABLE inspection_checkpoints (
  checkpoint_id text PRIMARY KEY,
  session_id    text NOT NULL REFERENCES inspection_sessions(session_id),
  reason        text NOT NULL,                         -- pause|end|manual
  payload       jsonb NOT NULL,                        -- {planVersion, sceneVersion, itemStatuses, openQuestions, inFlight, lastEventSeq, followups}
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_inscheckpoints_session ON inspection_checkpoints (session_id, created_at DESC);
