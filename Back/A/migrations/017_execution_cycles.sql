-- 02-execution 轮（增量，全部可加；不改写任何既有行）。
-- 1) 五区语义辅助回执落点（authority=none，非权威面）：最新一次语义运行摘要与身份。
ALTER TABLE arrow_jobs ADD COLUMN IF NOT EXISTS semantic jsonb;
-- 2) 同客户独立业务周期：履约→待外部回执→结清→关闭；返单=新周期引用已结清周期+新五区流程依据。
CREATE TABLE IF NOT EXISTS arrow_cycles (
 cycle_id text PRIMARY KEY,
 customer_id text NOT NULL REFERENCES customers(customer_id),
 tenant_id text NOT NULL,
 cycle_no integer NOT NULL,
 state text NOT NULL DEFAULT 'active',
 source_process_id text REFERENCES arrow_processes(process_id),
 reorder_of_cycle_id text REFERENCES arrow_cycles(cycle_id),
 internal_fulfillment jsonb,
 external_receipt jsonb,
 settlement jsonb,
 request_id text UNIQUE,
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS arrow_cycles_one_per_no ON arrow_cycles(customer_id,cycle_no);
