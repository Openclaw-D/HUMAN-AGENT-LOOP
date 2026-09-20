-- TAKEOFF-FA-1.0.0 · 首次回租准入预评估确认（A 权威面增量；契约 docs/takeoff/first-admission-v1/implementation/01/CONTRACT-PREASSESSMENT.md）
-- 原则：只新增对象/列/枚举值；不删不改既有行；回退 = 保留对象停用入口（与 008–011 同一口径）。
-- 不 seed 任何生产权限/政策数据；预评估确认授权走服务端目录角色。

-- 1) 评估输入版本：快照受影响 supersede 事件 +1（与 stale 标记同事务同 WHERE）；历史行保持 0 不推定。
ALTER TABLE credit_assessments ADD COLUMN input_version int NOT NULL DEFAULT 0;

-- 2) 状态枚举加法扩展：新增 'preassessment_confirmed'（既有枚举值与行数据零改动）。
ALTER TABLE credit_assessments DROP CONSTRAINT credit_assessments_status_check;
ALTER TABLE credit_assessments ADD CONSTRAINT credit_assessments_status_check
  CHECK (status IN ('draft','collecting','candidate_ready','awaiting_human_review','rejected','stale','superseded','preassessment_confirmed'));

-- 3) 候选修订历史（每次 submitCandidate 追加一行；历史永不改写；legacy candidate jsonb 继续承载当前版）。
CREATE TABLE assessment_candidates (
  candidate_id           text PRIMARY KEY,
  tenant_id              text NOT NULL,
  customer_id            text NOT NULL REFERENCES customers(customer_id),
  assessment_id          text NOT NULL REFERENCES credit_assessments(assessment_id),
  revision               int NOT NULL,
  tendency               text NOT NULL,
  suggested_amount_minor bigint,
  currency               text NOT NULL DEFAULT 'CNY',
  suggested_term_months  int,
  reference_price_minor  bigint,
  price_unit             text,
  price_basis            text,
  conditions             jsonb NOT NULL DEFAULT '[]'::jsonb,
  rationale              text NOT NULL DEFAULT '',
  produced_by            text NOT NULL,
  warnings               jsonb NOT NULL DEFAULT '[]'::jsonb,
  basis_refs             jsonb NOT NULL DEFAULT '[]'::jsonb,
  run_refs               jsonb NOT NULL DEFAULT '[]'::jsonb,
  change_reason          text,
  rule_version           text,
  input_version          int NOT NULL DEFAULT 0,
  produced_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, revision)
);
CREATE INDEX idx_ass_candidates_assessment ON assessment_candidates (assessment_id, revision DESC);

-- 4) 预评估确认记录（每评估至多一条；UNIQUE 强制；needs_review 由快照受影响 supersede 事件置位，永不覆盖/删除确认本体）。
CREATE TABLE preassessment_confirmations (
  confirmation_id    text PRIMARY KEY,
  tenant_id          text NOT NULL,
  customer_id        text NOT NULL REFERENCES customers(customer_id),
  assessment_id      text NOT NULL UNIQUE REFERENCES credit_assessments(assessment_id),
  outcome            text NOT NULL CHECK (outcome IN ('support','support_with_conditions','not_support')),
  scope              text NOT NULL DEFAULT 'preassessment_only' CHECK (scope = 'preassessment_only'),
  assessment_version int NOT NULL,          -- 确认时请求绑定的版本（确认后行版本 = 该值 + 1）
  candidate_revision int,
  input_version      int NOT NULL DEFAULT 0,
  snapshot_hash      text NOT NULL,
  rule_version       text NOT NULL,
  conditions         jsonb NOT NULL DEFAULT '[]'::jsonb,
  rationale          text NOT NULL DEFAULT '',
  confirmed_by       text NOT NULL,
  role_ref           text NOT NULL,
  permission_ref     text NOT NULL,
  needs_review       boolean NOT NULL DEFAULT false,
  review_reason      text,
  review_marked_at   timestamptz,
  confirmed_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_preconfirm_customer ON preassessment_confirmations (customer_id);

-- 5) 一次性回填：既有 candidate IS NOT NULL 的评估 → revision=1 历史行（字段缺失即 NULL，不编造；input_version 保持 0）。
INSERT INTO assessment_candidates (
  candidate_id, tenant_id, customer_id, assessment_id, revision, tendency, suggested_amount_minor, currency,
  conditions, rationale, produced_by, warnings, rule_version, input_version, produced_at
)
SELECT
  'cand-' || substring(a.assessment_id from 5) || '-r1',
  a.tenant_id, a.customer_id, a.assessment_id, 1,
  a.candidate->>'tendency',
  NULLIF(a.candidate->>'supportableAmountMinor', '')::bigint,
  COALESCE(a.candidate->>'currency', 'CNY'),
  COALESCE(a.candidate->'conditions', '[]'::jsonb),
  COALESCE(a.candidate->>'rationale', ''),
  COALESCE(a.candidate->>'producedBy', 'legacy-import'),
  COALESCE(a.candidate->'warnings', '[]'::jsonb),
  a.rule_version,
  0,
  a.updated_at
FROM credit_assessments a
WHERE a.candidate IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM assessment_candidates c WHERE c.assessment_id = a.assessment_id);
