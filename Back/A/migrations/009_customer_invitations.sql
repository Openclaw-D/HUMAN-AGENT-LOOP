-- goal-01（四任务产品交付轮）v2.4：受限邀请 + 客户联系人身份 + 材料处理状态权威投影。
-- 原则同 005-008：只新增对象；不改写既有行；回退 = 保留对象停用入口。
-- 邀请码/客户凭据仅存 sha256；明文只在创建/兑换响应中出现一次。
-- 客户联系人身份（customer_identities）是 A 内核首批 DB 侧动态身份：
-- 校验链 = 进程内合成目录未命中 → 本表（kind=human、单客户 grant、roles=['customer',<role>]）。

CREATE TABLE customer_invitations (
  invitation_id   text PRIMARY KEY,
  tenant_id       text NOT NULL,
  customer_id     text NOT NULL REFERENCES customers(customer_id),
  role            text NOT NULL CHECK (role IN ('customer-owner','customer-finance','customer-plant')),
  allowed_kinds   jsonb NOT NULL,                       -- 材料种类白名单（非空字符串数组）
  subject_ref     text,                                 -- 可选：限定对象（如设备/主体 ref）
  note            text,
  code_sha256     text NOT NULL UNIQUE,                 -- 邀请码仅存哈希
  expires_at      timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','used','revoked')),
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  used_at         timestamptz,
  used_principal_id text,
  redeem_request_id text                                -- 兑换响应丢失时的对账锚点（可选）
);
CREATE INDEX idx_customer_invitations_customer ON customer_invitations (customer_id, status);

CREATE TABLE customer_identities (
  principal_id    text PRIMARY KEY,                     -- 形如 ci-*
  tenant_id       text NOT NULL,
  customer_id     text NOT NULL REFERENCES customers(customer_id),
  role            text NOT NULL CHECK (role IN ('customer-owner','customer-finance','customer-plant')),
  allowed_kinds   jsonb NOT NULL,
  display_name    text,
  credential_sha256 text NOT NULL UNIQUE,               -- 客户凭据仅存哈希
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_invitation_id text REFERENCES customer_invitations(invitation_id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_customer_identities_customer ON customer_identities (customer_id, status);

-- 材料处理状态（权威投影；写口仅 kind=service，阶段在 runRef 内严格递增，
-- 新 runRef = 新处理尝试；不承载任何金额/授信语义）
CREATE TABLE artifact_processing (
  id              bigserial PRIMARY KEY,
  tenant_id       text NOT NULL,
  customer_id     text NOT NULL REFERENCES customers(customer_id),
  artifact_id     text NOT NULL REFERENCES evidence_artifacts(artifact_id),
  run_ref         text NOT NULL,
  stage           text NOT NULL CHECK (stage IN ('received','parsed','analyzed','needs_review','failed')),
  stage_rank      int NOT NULL,
  detail          text,
  failure_reason  text,
  next_action     text,
  registered_by   text NOT NULL,
  registered_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, run_ref, stage_rank)
);
CREATE INDEX idx_artifact_processing_current ON artifact_processing (artifact_id, id DESC);
