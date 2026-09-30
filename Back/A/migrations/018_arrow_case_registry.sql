-- 收尾02（2026-09-30 十案例轮；增量，全部可加；不改写任何既有行）。
-- A 正式案例登记表：案例=客户+展示序+分类+业务名+要点（arrow-cases 权威读面的登记源）。
-- 检查点/下一动作不落此表——它们从真实执行状态（arrow_processes/jobs/cycles/评估）读时推导，
-- 本表只承载"哪个客户以什么顺序/标题展示"的登记事实，不是结论权威。
CREATE TABLE IF NOT EXISTS arrow_case_registry (
 case_id text PRIMARY KEY,
 tenant_id text NOT NULL,
 customer_id text NOT NULL UNIQUE REFERENCES customers(customer_id),
 display_order integer NOT NULL,
 category text NOT NULL,
 business_name text NOT NULL,
 summary text NOT NULL,
 batch text NOT NULL DEFAULT 'checkpoint',
 config jsonb NOT NULL DEFAULT '{}',
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS arrow_case_one_order ON arrow_case_registry(tenant_id, display_order);
