-- Mensagem customizável que o bot envia pedindo o e-mail após o pagamento
-- (só usada quando collect_email_after_payment = true).
-- NULL/vazio = usa o texto padrão embutido no servidor.
-- Suporta HTML básico do Telegram (<b>, <i>, <code>...).
alter table public.bots
  add column email_request_message text;
