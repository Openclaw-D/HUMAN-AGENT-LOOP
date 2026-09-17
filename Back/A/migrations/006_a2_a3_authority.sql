-- 任务01·A2/A3 提交边界（审核 F02/F03/F06/F10 修复）：可信规则回执、分析运行登记、
-- 必需域政策、提额（再评估）请求与依据包豁免。
-- 原则同 005：不改写 001–005 既有行；只新增对象与可空列；
-- 登记表无行 = 对应检查不激活（能力随登记/配置启用，不在迁移里编造任何政策值）。

-- ============ A2.3/K05·K06 可信 Gate 回执：Gate 结论只能由获准服务身份登记，业务人员不得自报 CLEAR ============
-- A 侧只消费回执引用；rulesetVersion 必须是已激活规则版本（rule_pack_versions）。
CREATE TABLE rule_gate_receipts (
  receipt_id      text PRIMARY KEY,
  tenant_id       text NOT NULL,
  customer_id     text NOT NULL REFERENCES customers(customer_id),
  result          text NOT NULL CHECK (result IN ('CLEAR','NEEDS_EVIDENCE','HOLD_FOR_REVIEW','HARD_BLOCK')),
  ruleset_version text NOT NULL,
  reason_codes    jsonb NOT NULL DEFAULT '[]'::jsonb,
  rule_ids        jsonb NOT NULL DEFAULT '[]'::jsonb,
  blocked_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_refs   jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_digest    text,
  evaluated_at    timestamptz,
  registered_by   text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_gate_receipts_customer ON rule_gate_receipts (customer_id, created_at);

-- ============ A2.7/K10 激活规则版本登记（规则当前性的服务端事实源；同一时刻至多一个 active） ============
-- domains='[]' 表示全域适用；登记为空 = 规则当前性仅按证据摘要判定（能力随登记启用）。
CREATE TABLE rule_pack_versions (
  version      text PRIMARY KEY,
  status       text NOT NULL CHECK (status IN ('draft','active','retired')),
  domains      jsonb NOT NULL DEFAULT '[]'::jsonb,
  note         text NOT NULL DEFAULT '',
  activated_by text,
  activated_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_rule_pack_single_active ON rule_pack_versions (status) WHERE status = 'active';

-- ============ A2.6/K08·K09 分析运行登记：执行开始即登记输入快照；输出登记只校验"执行所用输入" ============
-- input_digest 由 A 在 start 时按声明依赖对当时 DB 计算并盖章；结果登记禁止用当前 DB 摘要替旧分析盖章。
CREATE TABLE analysis_runs (
  run_id            text PRIMARY KEY,
  tenant_id         text NOT NULL,
  customer_id       text NOT NULL REFERENCES customers(customer_id),
  domain            text NOT NULL CHECK (domain IN ('policy','credit','commerce','asset')),
  deps              jsonb NOT NULL,
  input_snapshot_id text,
  input_digest      text NOT NULL,
  rule_version      text NOT NULL,
  provider_mode     text NOT NULL DEFAULT 'simulation',
  status            text NOT NULL CHECK (status IN ('running','completed','failed','timeout','not_configured','input_invalid')),
  started_by        text NOT NULL,
  started_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  completed_by      text
);
CREATE INDEX idx_analysis_runs_customer ON analysis_runs (customer_id, domain);

-- ============ A2.2/K05 必需域政策：必需域来自批准政策，不由调用者 [] / required=false 关闭 ============
-- 政策版本未配置（config 缺省）→ 冻结一律 POLICY_PENDING（fail-closed，不猜测）。
CREATE TABLE domain_requirement_policies (
  policy_version         text NOT NULL,
  domain                 text NOT NULL CHECK (domain IN ('policy','credit','commerce','asset')),
  required               boolean NOT NULL,
  min_independent_proofs int,
  created_by             text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (policy_version, domain)
);

-- ============ A2.2 依据包豁免：不适用域必须显式豁免（范围+理由+批准人），可审计 ============
ALTER TABLE decision_packages ADD COLUMN exemptions jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ============ A3.7/K17·K18 客户级提额（再评估）请求：在途唯一、次数窗口、实质新证据、nextEligibleAt ============
-- 客户级（跨渠道/业务员）限制；重试经 requestId 幂等不重复计数；系统失败回滚不消耗次数。
CREATE TABLE credit_limit_requests (
  request_id             text PRIMARY KEY,
  tenant_id              text NOT NULL,
  customer_id            text NOT NULL REFERENCES customers(customer_id),
  requested_amount_minor bigint NOT NULL CHECK (requested_amount_minor > 0),
  currency               text NOT NULL,
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','rejected','withdrawn')),
  evidence_refs          jsonb NOT NULL DEFAULT '[]'::jsonb,
  requested_by           text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  resolved_at            timestamptz,
  resolved_by            text,
  resolution_note        text NOT NULL DEFAULT '',
  facility_id            text,
  next_eligible_at       timestamptz
);
CREATE UNIQUE INDEX uq_limit_request_open ON credit_limit_requests (customer_id) WHERE status = 'open';
CREATE INDEX idx_limit_requests_customer ON credit_limit_requests (customer_id, created_at);
