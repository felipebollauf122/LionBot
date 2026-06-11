-- Timeline de conversa bot<->lead para a aba CLIENTES + chat ao vivo.
--
-- Guarda SÓ o necessário pra montar o chat de atendimento:
--   - 'in'    : texto que o LEAD mandou (capturado no webhook do Telegram)
--   - 'out'   : texto que o OPERADOR mandou pelo painel (endpoint send-message)
--   - 'event' : marcos do funil (clique em botão, PIX gerado, venda paga,
--               bloqueio) — event_type diz qual.
--
-- NÃO guarda o que o bot AUTOMÁTICO dispara nos fluxos (engine intacto).
-- Retenção: 30 dias (cleanup diário no server — ver queue.ts).
--
-- O Telegram (Bot API e MTProto) NÃO expõe histórico de DMs bot<->lead, então
-- esta tabela é a ÚNICA fonte do chat. Sem ela, não há o que "puxar".

create table if not exists public.lead_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  bot_id uuid not null references public.bots(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 'in' (lead) | 'out' (operador) | 'event' (marco do funil)
  direction text not null check (direction in ('in', 'out', 'event')),
  text text,
  -- preenchido quando direction = 'event':
  --   'button_click' | 'pix_generated' | 'payment_approved' | 'blocked'
  event_type text check (
    event_type is null or event_type in (
      'button_click', 'pix_generated', 'payment_approved', 'blocked'
    )
  ),
  -- contexto extra do evento (ex.: { product_name, amount } no payment;
  -- { button_label } no clique). Texto humano fica em `text`.
  event_data jsonb not null default '{}'::jsonb,
  -- quem originou um 'out': 'operator' (painel). Reservado p/ futuro 'bot'.
  sent_by text,
  -- id da mensagem no Telegram (quando aplicável) — evita duplicar no realtime.
  tg_message_id bigint,
  created_at timestamptz not null default now()
);

-- Hot path do painel: buscar a conversa de UM lead em ordem cronológica.
create index if not exists idx_lead_messages_lead_created
  on public.lead_messages (lead_id, created_at asc);

-- Cleanup diário varre por idade.
create index if not exists idx_lead_messages_created
  on public.lead_messages (created_at);

alter table public.lead_messages enable row level security;

-- RLS: o dono do bot lê as mensagens dos próprios leads.
-- Admin/owner: as outras tabelas usam policies separadas por role; aqui o
-- escopo por tenant_id = auth.uid() cobre o dono. O service_role do server
-- (insert) ignora RLS, então o write não depende desta policy.
create policy "tenants read own lead messages"
  on public.lead_messages
  for select
  using (tenant_id = auth.uid());
