/** A campanha no banco é a intenção do usuário; a fila pode ser reconstruída. */
export interface RecoverableCampaign {
  id: string;
  status: string;
  next_run_at: string | null;
  is_processing: boolean;
  processing_started_at: string | null;
}

export function campaignNeedsJob(c: RecoverableCampaign, now = Date.now()): boolean {
  if (c.status !== "running" && c.status !== "scheduled") return false;
  if (c.status === "scheduled" && c.next_run_at && Date.parse(c.next_run_at) > now) return false;
  // O worker renova este heartbeat. Um processo vivo não perde a exclusão
  // só porque uma campanha longa ultrapassou o TTL da hora de início.
  return !c.is_processing || !c.processing_started_at || Date.parse(c.processing_started_at) < now - 120_000;
}

export async function recoverCampaigns(
  campaigns: RecoverableCampaign[],
  enqueue: (id: string) => Promise<void>,
  onError: (id: string, error: unknown) => void,
  now = Date.now(),
): Promise<void> {
  for (const campaign of campaigns) {
    if (!campaignNeedsJob(campaign, now)) continue;
    try { await enqueue(campaign.id); }
    catch (error) { onError(campaign.id, error); }
  }
}

export function transientCampaignError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /TIMEOUT|TIMED_OUT|ECONN|ENET|EAI_AGAIN|fetch failed|disconnected|Not connected|CONNECTION|RPC_CALL_FAIL|INTERNAL_SERVER_ERROR/i.test(text);
}
