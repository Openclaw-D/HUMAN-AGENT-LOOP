-- §11.1（2026-09-19 路B=任务01）：交付运行时服务身份（DEF-G04N-04 A 侧）。
-- 原则同 005-009：只新增对象；不改写既有行；回退 = 保留对象停用入口。
-- 背景：G2/A2/G3 的 service 专用写口在交付运行时无可认证 service 主体 → 依据包可信链不可达。
-- 本表提供 DB 侧动态 service 身份（与合成目录同效）：凭据仅存 sha256，明文只在创建响应出现一次；
-- 身份链 = 合成目录未命中 → customer_identities 未命中 → 本表（kind=service、租户绑定、customers='all'）。

CREATE TABLE service_identities (
  principal_id      text PRIMARY KEY,                     -- 形如 svc-*
  tenant_id         text NOT NULL,
  display_name      text NOT NULL DEFAULT '',
  credential_sha256 text NOT NULL UNIQUE,                 -- 服务凭据仅存哈希
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  disabled_at       timestamptz,
  disabled_by       text
);
CREATE INDEX idx_service_identities_tenant ON service_identities (tenant_id, status);
