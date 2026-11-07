select pgmq.create('jobs_high');
select pgmq.create('jobs_bulk');

-- pgmq tables must not be reachable through the Data API.
alter table pgmq.q_jobs_high enable row level security;
alter table pgmq.q_jobs_bulk enable row level security;
alter table pgmq.a_jobs_high enable row level security;
alter table pgmq.a_jobs_bulk enable row level security;
