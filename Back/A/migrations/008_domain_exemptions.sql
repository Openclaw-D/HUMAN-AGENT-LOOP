-- goal-01 · A2（不变量 2 收口）：豁免必须引用真实、有效且有权批准的记录。
-- 依据包必需域豁免与差异 not_applicable 的政策豁免改为引用本登记表（服务端从凭据解析批准人，
-- 拒绝请求自报 approvedBy）。登记无行 = 豁免通道未授权（矩阵动作 domain-exemption.grant fail-closed）。
-- 原则同 005-007：只新增对象；不改写既有行；回退 = 保留对象停用入口。

CREATE TABLE domain_exemptions (
  exemption_id      text PRIMARY KEY,
  tenant_id         text NOT NULL,
  customer_id       text NOT NULL REFERENCES customers(customer_id),
  domain            text NOT NULL CHECK (domain IN ('policy','credit','commerce','asset')),
  -- scope：'package' = 依据包必需域豁免；规则/差异豁免 = 规则ID、差异类型或 'any'
  scope             text NOT NULL DEFAULT 'package',
  reason            text NOT NULL,
  policy_version    text NOT NULL,
  approved_by       text NOT NULL,
  approved_by_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  valid_until       timestamptz,
  status            text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','revoked')),
  revoked_at        timestamptz,
  revoked_by        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_domain_exemptions_customer ON domain_exemptions (customer_id, domain, status);
