CREATE TABLE public.mtproto_accounts (id text PRIMARY KEY, status text, flood_wait_until timestamptz, last_error text);
CREATE TABLE public.mtproto_campaigns (id text PRIMARY KEY, status text, started_at timestamptz, last_run_at timestamptz, next_run_at timestamptz, recurrence_seconds integer);
CREATE TABLE public.mtproto_targets (id text PRIMARY KEY, campaign_id text, status text, retry_after timestamptz, error_message text);

INSERT INTO mtproto_accounts VALUES ('peer', 'flood_wait', now() + interval '24 hours', 'PEER_FLOOD'), ('real', 'flood_wait', now() + interval '30 minutes', 'FLOOD_WAIT_1800');
INSERT INTO mtproto_campaigns VALUES
  ('peer', 'scheduled', now() - interval '1 minute', NULL, now() + interval '24 hours', 3),
  ('real', 'scheduled', now() - interval '1 minute', NULL, now() + interval '30 minutes', 3),
  ('cycle', 'scheduled', NULL, now() - interval '10 seconds', now() + interval '1 hour', 3600),
  ('running', 'running', now(), NULL, NULL, 3600);
INSERT INTO mtproto_targets VALUES ('peer', 'peer', 'pending', now() + interval '24 hours', 'PEER_FLOOD'), ('real', 'real', 'pending', now() + interval '30 minutes', 'FLOOD_WAIT_1800');

\ir /tmp/migration.sql

DO $$ BEGIN
  IF (SELECT status FROM mtproto_accounts WHERE id = 'peer') <> 'active' THEN RAISE EXCEPTION 'Artificial account wait remains'; END IF;
  IF (SELECT next_run_at > now() FROM mtproto_campaigns WHERE id = 'peer') THEN RAISE EXCEPTION 'Artificial campaign wait remains'; END IF;
  IF (SELECT retry_after > now() FROM mtproto_targets WHERE id = 'peer') THEN RAISE EXCEPTION 'Artificial target wait remains'; END IF;
  IF (SELECT status FROM mtproto_accounts WHERE id = 'real') <> 'flood_wait' THEN RAISE EXCEPTION 'Real account wait was removed'; END IF;
  IF (SELECT retry_after <= now() FROM mtproto_targets WHERE id = 'real') THEN RAISE EXCEPTION 'Real target wait was removed'; END IF;
END $$;

UPDATE mtproto_campaigns SET recurrence_seconds = 3;
DO $$ BEGIN
  IF (SELECT next_run_at > now() FROM mtproto_campaigns WHERE id = 'cycle') THEN RAISE EXCEPTION 'Recurrence edit did not advance schedule'; END IF;
  IF (SELECT next_run_at <= now() FROM mtproto_campaigns WHERE id = 'real') THEN RAISE EXCEPTION 'Edit removed real Telegram wait'; END IF;
  IF (SELECT status FROM mtproto_campaigns WHERE id = 'running') <> 'running' THEN RAISE EXCEPTION 'Edit interrupted campaign'; END IF;
END $$;
