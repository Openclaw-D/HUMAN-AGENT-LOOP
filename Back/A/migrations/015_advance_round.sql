-- Local additive migration; do not apply to shared runtime without explicit authorization.
CREATE TABLE advance_rounds (
  round_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  customer_id text NOT NULL REFERENCES customers(customer_id),
  principal_id text NOT NULL,
  request_id text NOT NULL,
  domain text NOT NULL,
  round_no integer NOT NULL,
  basis_hash text NOT NULL,
  payload_hash text NOT NULL,
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_id, round_no),
  UNIQUE(tenant_id, customer_id, principal_id, request_id)
);
CREATE INDEX advance_rounds_customer ON advance_rounds(customer_id, domain, round_no);
CREATE TABLE advance_column_tasks (
  job_id text PRIMARY KEY,
  round_id text NOT NULL REFERENCES advance_rounds(round_id),
  domain text NOT NULL,
  dependency_hash text NOT NULL,
  state text NOT NULL CHECK(state IN ('received','waiting_dependency','stopped')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(round_id, domain)
);
