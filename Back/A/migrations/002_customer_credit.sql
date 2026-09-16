-- 任务01 · 客户级授信内核 schema（S2/S3/S4）
-- 设计依据：docs/customer-next/S1_CREDIT_DOMAIN_ADR.md（D1–D10）、S1_API_V2_SCHEMA_PROPOSAL.md、S1_MIGRATION_AND_COMPAT.md §1。
-- 原则：不改动 001 既有对象语义；只新增对象与 projects.customer_id 可空列；金额一律整数分（bigint）；
--       账本追加式（不删不改）；权限矩阵不在此种子任何"生产"条目——正式动作在未配置授权目录时一律 policy_pending。

-- ============ 客户主档（D1：企业法律主体，禁止自动合并） ============
CREATE TABLE customers (
  customer_id      text PRIMARY KEY,
  tenant_id        text NOT NULL,
  legal_entity_ref text NOT NULL,              -- 统一社会信用代码等法定标识（租户内唯一；同名不同主体可并存）
  display_name     text NOT NULL,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('prospective','active','suspended','closed')),
  version          int NOT NULL DEFAULT 1,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, legal_entity_ref)
);
CREATE INDEX idx_customers_tenant ON customers (tenant_id);

-- ============ 客户关系（D1：控制/担保/供应商/关联组；联系人只是渠道引用，不是主体） ============
CREATE TABLE customer_relationships (
  relationship_id     text PRIMARY KEY,
  tenant_id           text NOT NULL,
  from_customer_id    text NOT NULL REFERENCES customers(customer_id),
  to_customer_id      text REFERENCES customers(customer_id),  -- 可空：外部主体或联系人引用
  external_entity_ref text,
  contact_ref         text,                                     -- 企微联系人等渠道标识（绝不作为合并依据）
  type                text NOT NULL CHECK (type IN ('control','guarantee','supplier','related_group','contact')),
  evidence_refs       jsonb NOT NULL DEFAULT '[]'::jsonb,       -- EvidenceArtifact id 数组
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','verified','disputed')),
  valid_from          timestamptz,
  valid_to            timestamptz,
  version             int NOT NULL DEFAULT 1,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reln_from ON customer_relationships (from_customer_id);
CREATE INDEX idx_reln_to ON customer_relationships (to_customer_id);

-- ============ 证据工件与事实断言（D8：发票与合同并存；只有显式 supersede 才取代） ============
CREATE TABLE evidence_artifacts (
  artifact_id   text PRIMARY KEY,
  tenant_id     text NOT NULL,
  customer_id   text NOT NULL REFERENCES customers(customer_id),
  project_id    text REFERENCES projects(project_id),           -- 可选关联到既有项目
  kind          text NOT NULL,                                  -- invoice | purchase_contract | ...
  fact_key      text,                                           -- 业务事实键（如 equipment_price）；可空
  content       jsonb NOT NULL,
  sha256        text NOT NULL,                                  -- 规范化内容哈希；重复材料据此关联而非重复计数
  supersedes    text REFERENCES evidence_artifacts(artifact_id),
  superseded_by text,
  duplicate_of  text REFERENCES evidence_artifacts(artifact_id), -- 完全同内容重复提交 → 指向首件，不产生新证明力
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_artifacts_customer ON evidence_artifacts (customer_id, kind);
CREATE UNIQUE INDEX uq_artifacts_content ON evidence_artifacts (customer_id, sha256)
  WHERE duplicate_of IS NULL AND superseded_by IS NULL;

CREATE TABLE fact_assertions (
  assertion_id text PRIMARY KEY,
  tenant_id    text NOT NULL,
  customer_id  text NOT NULL REFERENCES customers(customer_id),
  fact_key     text NOT NULL,
  value        jsonb NOT NULL,
  grade        text NOT NULL CHECK (grade IN ('confirmed','source_supported','inference','unverified','unknown')),
  artifact_id  text NOT NULL REFERENCES evidence_artifacts(artifact_id),
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_facts_customer_key ON fact_assertions (customer_id, fact_key);

-- ============ 授信评估（D3：候选 authority=none；评估终点是待人类审阅） ============
CREATE TABLE credit_assessments (
  assessment_id    text PRIMARY KEY,
  tenant_id        text NOT NULL,
  customer_id      text NOT NULL REFERENCES customers(customer_id),
  status           text NOT NULL DEFAULT 'collecting'
                   CHECK (status IN ('draft','collecting','candidate_ready','awaiting_human_review','rejected','stale','superseded')),
  evidence_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,          -- [{artifactId,sha256,factKey}] 冻结引用
  snapshot_hash    text NOT NULL,                                -- sha256(规范化 snapshot)；批准事务据此复查
  rule_version     text NOT NULL,
  caliber_version  text NOT NULL DEFAULT 'v1',
  candidate        jsonb,                                        -- CreditCandidate 严格 Schema（authority 恒 none）
  stale            boolean NOT NULL DEFAULT false,               -- 依据失效标记（S4）
  stale_reasons    jsonb NOT NULL DEFAULT '[]'::jsonb,
  version          int NOT NULL DEFAULT 1,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_assessments_customer ON credit_assessments (customer_id);

-- ============ 授信额度（D4：proposed→approved_inactive→active→suspended/expired/closed） ============
CREATE TABLE credit_facilities (
  facility_id          text PRIMARY KEY,
  tenant_id            text NOT NULL,
  customer_id          text NOT NULL REFERENCES customers(customer_id),
  approved_amount_minor bigint NOT NULL CHECK (approved_amount_minor >= 0),
  currency             text NOT NULL,
  effective_from       date,
  effective_to         date,
  revolving            boolean NOT NULL DEFAULT false,           -- P-02 safe default：非循环
  reserve_ttl_seconds  int,                                       -- NULL=预占不自动过期
  product_scope        jsonb NOT NULL DEFAULT '[]'::jsonb,       -- ['direct_lease','sale_leaseback']
  conditions           jsonb NOT NULL DEFAULT '[]'::jsonb,
  approval_chain       jsonb NOT NULL DEFAULT '[]'::jsonb,       -- DecisionRecord id 数组
  basis                jsonb NOT NULL,                            -- {assessmentId,ruleVersion,snapshotHash}
  status               text NOT NULL DEFAULT 'proposed'
                       CHECK (status IN ('proposed','approved_inactive','active','suspended','expired','closed')),
  version              int NOT NULL DEFAULT 1,
  created_by           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_facilities_customer ON credit_facilities (customer_id);

-- ============ 融资申请（D2：交易层承载直租/回租要件） ============
CREATE TABLE financing_requests (
  fr_id          text PRIMARY KEY,
  tenant_id      text NOT NULL,
  customer_id    text NOT NULL REFERENCES customers(customer_id),
  facility_id    text NOT NULL REFERENCES credit_facilities(facility_id),
  product_type   text NOT NULL CHECK (product_type IN ('direct_lease','sale_leaseback')),
  amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
  currency       text NOT NULL,
  equipment_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  contract_refs  jsonb NOT NULL DEFAULT '[]'::jsonb,
  status         text NOT NULL DEFAULT 'submitted'
                 CHECK (status IN ('draft','submitted','reserved','committed','disbursing_unknown','disbursed','settled','cancelled','rejected')),
  external_state text NOT NULL DEFAULT 'none' CHECK (external_state IN ('none','sent','unknown','confirmed')),
  external_ref  text,                                               -- 受控模拟出账适配器引用（txId）
  reserved_until timestamptz,                                     -- 预占有效期；external_state≠none 时绝不自动清理
  version        int NOT NULL DEFAULT 1,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_frs_customer ON financing_requests (customer_id);
CREATE INDEX idx_frs_facility ON financing_requests (facility_id);

-- ============ 敞口账目（D4：追加式；余额是推导值；与业务写同事务） ============
-- 桶语义（entry_type → 桶增量）：
--   reserve:+reserved  reserve_release:-reserved  reserve_expire:-reserved
--   reserve_commit:-reserved/+committed  commit_cancel:-committed
--   disburse:-committed/+outstanding  settle:-outstanding  adjust:±(政策性调整,本轮不用)
CREATE TABLE exposure_entries (
  seq          bigserial PRIMARY KEY,
  entry_id     text NOT NULL UNIQUE,
  tenant_id    text NOT NULL,
  customer_id  text NOT NULL,
  facility_id  text NOT NULL,
  fr_id        text,
  entry_type   text NOT NULL CHECK (entry_type IN ('reserve','reserve_release','reserve_expire','reserve_commit','commit_cancel','disburse','settle','adjust')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency     text NOT NULL,
  request_scope text NOT NULL,          -- 作用域哈希（tenant|principal|action|resource）
  request_id   text NOT NULL,
  tx_id        text NOT NULL,
  actor        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_scope, request_id, entry_type)   -- A08/A13：同作用域同请求同类型至多一条账目
);
CREATE INDEX idx_exposure_facility ON exposure_entries (facility_id);
CREATE INDEX idx_exposure_customer ON exposure_entries (customer_id);

-- ============ 正式决定记录（D7：人类权威；与 audit_events 互补） ============
CREATE TABLE decision_records (
  decision_id     text PRIMARY KEY,
  tenant_id       text NOT NULL,
  actor_principal text NOT NULL,
  actor_kind      text NOT NULL,
  role_ref        text NOT NULL,          -- 服务端目录中的职责（非载荷自报）
  permission_ref  text NOT NULL,          -- 命中的权限矩阵条目 matrix_version|role|action
  action          text NOT NULL,
  subject_type    text NOT NULL,
  subject_id      text NOT NULL,
  customer_id     text,
  rule_version    text,
  basis_ref       text,                   -- assessmentId+snapshotHash 等
  rationale       text NOT NULL DEFAULT '',
  conditions      jsonb NOT NULL DEFAULT '[]'::jsonb,
  before_version  int,
  after_version   int,
  decided_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_decisions_customer ON decision_records (customer_id);

-- ============ 权限矩阵（D7/P-05：内容由公司批准后录入；服务端按 config 激活的版本查询） ============
-- 本迁移不插入任何行：矩阵缺失 = policy_pending，正式动作全拒（fail-closed）。
CREATE TABLE permission_matrix (
  matrix_version  text NOT NULL,
  role            text NOT NULL,
  action          text NOT NULL,
  allowed         boolean NOT NULL,
  max_amount_minor bigint,                -- NULL=不设金额档；非 NULL 时请求金额不得超过
  PRIMARY KEY (matrix_version, role, action)
);

-- ============ v2 作用域幂等表（D6：scope 含 tenant|principal|action|resource） ============
CREATE TABLE v2_idempotency (
  scope_hash     text NOT NULL,
  request_id     text NOT NULL,
  tenant_id      text NOT NULL,
  principal_id   text NOT NULL,
  action         text NOT NULL,
  payload_sha256 text NOT NULL,
  response       jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_hash, request_id)
);
CREATE INDEX idx_v2_idem_owner ON v2_idempotency (tenant_id, principal_id, request_id);

-- ============ 既有对象增量 ============
ALTER TABLE projects ADD COLUMN customer_id text REFERENCES customers(customer_id);
ALTER TABLE outbox_events ADD COLUMN customer_id text;
CREATE INDEX idx_outbox_customer ON outbox_events (customer_id, seq);
