-- Recalcula a próxima recorrência na mesma transação da edição, sem corrida
-- com o worker e sem sobrescrever uma espera real informada pelo Telegram.
CREATE OR REPLACE FUNCTION public.mtproto_campaign_reschedule_edit()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'scheduled' AND NEW.started_at IS NULL
     AND NEW.recurrence_seconds IS DISTINCT FROM OLD.recurrence_seconds THEN
    NEW.next_run_at := CASE WHEN NEW.recurrence_seconds IS NULL THEN now()
      ELSE greatest(now(), coalesce(NEW.last_run_at, now()) + make_interval(secs => NEW.recurrence_seconds)) END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mtproto_campaign_reschedule_edit ON public.mtproto_campaigns;
CREATE TRIGGER mtproto_campaign_reschedule_edit
BEFORE UPDATE OF recurrence_seconds ON public.mtproto_campaigns
FOR EACH ROW EXECUTE FUNCTION public.mtproto_campaign_reschedule_edit();

-- Remove somente prazos inventados pelo aplicativo. FLOOD_WAIT com duração
-- explícita continua intacto, inclusive em contas usadas por outras campanhas.
UPDATE public.mtproto_accounts
SET status = 'active', flood_wait_until = NULL
WHERE status = 'flood_wait' AND last_error = 'PEER_FLOOD';

UPDATE public.mtproto_targets
SET retry_after = now()
WHERE status = 'pending' AND retry_after > now()
  AND error_message IN ('PEER_FLOOD', 'CONNECTION_RETRY', 'ACCOUNT_UNAVAILABLE');

UPDATE public.mtproto_campaigns c
SET next_run_at = now()
WHERE c.status = 'scheduled' AND c.next_run_at > now()
  AND c.started_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.mtproto_targets t WHERE t.campaign_id = c.id
    AND t.status = 'pending' AND t.retry_after <= now()
    AND t.error_message IN ('PEER_FLOOD', 'CONNECTION_RETRY', 'ACCOUNT_UNAVAILABLE'));
