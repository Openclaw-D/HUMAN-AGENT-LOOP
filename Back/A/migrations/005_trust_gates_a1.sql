-- 任务01·A1 提交边界（审核 F01 修复）：权限与幂等归属。
-- 原则：不改写 001–004 既有行；只新增对象与可空列。旧数据新列 NULL=legacy（回执仅 admin 可读）。

-- ============ A1.3 幂等归属：v1 全局幂等表补 principal/op（X03：匿名/跨主体命中缓存） ============
ALTER TABLE idempotency ADD COLUMN principal_id text;
ALTER TABLE idempotency ADD COLUMN op text;
CREATE INDEX idx_idempotency_principal ON idempotency (principal_id, request_id);

-- ============ A1.1/K03 客户级授权登记表（'grant' 模式 principal 的可见客户；撤销即刻生效） ============
CREATE TABLE principal_customer_grants (
  tenant_id   text NOT NULL,
  principal_id text NOT NULL,
  customer_id text NOT NULL REFERENCES customers(customer_id),
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, principal_id, customer_id)
);
CREATE INDEX idx_pcg_principal ON principal_customer_grants (principal_id, customer_id);
