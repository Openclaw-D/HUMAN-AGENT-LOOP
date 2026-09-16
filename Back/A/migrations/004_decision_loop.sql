-- 任务02 · 决策闭环 schema（3.1 证据收口扩展 / 3.2 差异复核 / 3.3 评估依据包 / 3.5 报告视图 / B14 对象重关联）
-- 兼容原则：不改动 001/002 既有对象语义；只新增对象与既有表可空列；
-- 旧数据新增列一律 NULL=未知（显式标未知，禁止补造历史通过记录）；不迁移、不改写任何既有行。

-- ============ 证据工件扩展（3.1：同源派生 / 对象绑定 / 材料口径元数据） ============
-- provenance: {derivedFrom:[artifactId...], generator, generationKind} —— 派生材料不增加独立证明力（同源归并按根）
-- object_ref: {objectId, sceneVersion, sceneId?} —— 历史证据恒绑定原始 objectId+sceneVersion，改名/重建不自动转移
-- material_meta: {subjectRef?, periodFrom?, periodTo?, unit?, caliber?, page?, timeSpan?} —— 主体/期间/单位/口径与页/片段定位
ALTER TABLE evidence_artifacts ADD COLUMN provenance jsonb;
ALTER TABLE evidence_artifacts ADD COLUMN object_ref jsonb;
ALTER TABLE evidence_artifacts ADD COLUMN material_meta jsonb;

-- ============ 对象重关联（B14）：显式人工映射，追加式；映射无法确定 → 保持待重关联，不模糊匹配 ============
CREATE TABLE object_relinks (
  relink_id        text PRIMARY KEY,
  tenant_id        text NOT NULL,
  customer_id      text NOT NULL REFERENCES customers(customer_id),
  from_object_id   text NOT NULL,
  to_object_id     text NOT NULL,
  to_scene_version text NOT NULL,
  rationale        text NOT NULL DEFAULT '',
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_object_relinks_customer ON object_relinks (customer_id, from_object_id);

-- ============ 差异复核（3.2）：影响决策的差异必须有处理结果；ack/口述不能替代所需核验 ============
-- resolution.outcome ∈ explained_verified | adverse_confirmed | pending_evidence | not_applicable（按现有制度映射）
CREATE TABLE decision_findings (
  finding_id       text PRIMARY KEY,
  tenant_id        text NOT NULL,
  customer_id      text NOT NULL REFERENCES customers(customer_id),
  finding_type     text NOT NULL CHECK (finding_type IN ('material_conflict','caliber_difference','adverse_fact','verification_gap','data_anomaly')),
  assertion        text NOT NULL,
  side_a           jsonb NOT NULL DEFAULT '{}'::jsonb,
  side_b           jsonb NOT NULL DEFAULT '{}'::jsonb,
  rule_ref         jsonb,
  responsible_role text NOT NULL,
  impact_scope     jsonb NOT NULL DEFAULT '{}'::jsonb,
  required_action  jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity         text NOT NULL DEFAULT 'major' CHECK (severity IN ('minor','major','critical')),
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  resolution       jsonb,
  version          int NOT NULL DEFAULT 1,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_findings_customer ON decision_findings (customer_id, status);

-- ============ 评估依据包（3.3）：冻结修订不可变；新材料进新修订；既有包保留当时依据 ============
CREATE TABLE decision_packages (
  package_id          text PRIMARY KEY,
  tenant_id           text NOT NULL,
  customer_id         text NOT NULL REFERENCES customers(customer_id),
  revision            int NOT NULL,
  prev_package_id     text REFERENCES decision_packages(package_id),
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','superseded')),
  assessment_id       text REFERENCES credit_assessments(assessment_id),
  inspection_revision jsonb,
  evidence_refs       jsonb NOT NULL DEFAULT '[]'::jsonb,
  independent_proofs  int NOT NULL DEFAULT 0,
  snapshot_hash       text NOT NULL,
  gate                jsonb,
  candidate           jsonb,
  unknown_costs       jsonb NOT NULL DEFAULT '[]'::jsonb,
  domain_states       jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_reviews    jsonb NOT NULL DEFAULT '[]'::jsonb,
  open_items          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, revision)
);
CREATE INDEX idx_packages_customer ON decision_packages (customer_id, status);

-- ============ 四域结果（3.2/3.3）：原意见只追加不被汇总器改写；采用/不采用留人、理由与依据 ============
CREATE TABLE package_domain_results (
  result_id       text PRIMARY KEY,
  package_id      text NOT NULL REFERENCES decision_packages(package_id),
  domain          text NOT NULL CHECK (domain IN ('policy','credit','commerce','asset')),
  analysis_run    jsonb NOT NULL,
  opinion         jsonb NOT NULL,
  opinion_version int NOT NULL DEFAULT 1,
  deps            jsonb NOT NULL,
  adoption        jsonb,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, domain, opinion_version)
);

-- ============ 额度设施扩展：依据包绑定 + 提额冷却（冷却秒数未配置=机制不启用，不编造默认） ============
ALTER TABLE credit_facilities ADD COLUMN package_id text REFERENCES decision_packages(package_id);
ALTER TABLE credit_facilities ADD COLUMN cooling_until timestamptz;

-- ============ 会后报告视图（3.5）：版本化、可从结构化结果重建、按受众服务端投影 ============
CREATE TABLE report_views (
  report_id      text PRIMARY KEY,
  tenant_id      text NOT NULL,
  customer_id    text NOT NULL REFERENCES customers(customer_id),
  kind           text NOT NULL CHECK (kind IN ('internal_summary','customer_supplement','use_prep_sheet')),
  audience       text NOT NULL CHECK (audience IN ('internal','customer')),
  subject_type   text NOT NULL CHECK (subject_type IN ('decision_package','financing_request','customer')),
  subject_id     text NOT NULL,
  version        int NOT NULL,
  based_on_hash  text NOT NULL,
  content        jsonb NOT NULL,
  markdown       text NOT NULL,
  content_sha256 text NOT NULL,
  generated_by   text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, subject_id, based_on_hash)
);
CREATE INDEX idx_reports_customer ON report_views (customer_id, kind);
