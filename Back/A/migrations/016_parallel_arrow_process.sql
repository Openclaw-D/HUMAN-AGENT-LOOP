-- Additive isolated demonstration process. No existing approval or customer records rewritten.
CREATE TABLE arrow_processes (
 process_id text PRIMARY KEY, customer_id text NOT NULL REFERENCES customers(customer_id),
 tenant_id text NOT NULL, principal_id text NOT NULL, state text NOT NULL DEFAULT 'in_progress',
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), archive_ref text, terminal_ref text
);
CREATE UNIQUE INDEX arrow_one_open_process ON arrow_processes(customer_id,principal_id) WHERE state='in_progress';
CREATE TABLE arrow_jobs (
 job_id text PRIMARY KEY, process_id text NOT NULL REFERENCES arrow_processes(process_id),
 domain text NOT NULL, attempt integer NOT NULL, state text NOT NULL, basis_hash text NOT NULL,
 input jsonb NOT NULL, result jsonb, package_id text, analysis_run_id text, result_id text,
 selection jsonb, started_at timestamptz, finished_at timestamptz, reason text,
 UNIQUE(process_id,domain,attempt)
);
CREATE TABLE arrow_requests (
 process_id text NOT NULL REFERENCES arrow_processes(process_id), request_id text NOT NULL,
 payload_hash text NOT NULL, domain text NOT NULL, job_id text, command_state text NOT NULL DEFAULT 'accepted',
 PRIMARY KEY(process_id,request_id)
);
CREATE TABLE arrow_events (
 event_id uuid PRIMARY KEY, process_id text NOT NULL REFERENCES arrow_processes(process_id),
 version integer NOT NULL, event_type text NOT NULL, domain text, job_id text, payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(process_id,version)
);
