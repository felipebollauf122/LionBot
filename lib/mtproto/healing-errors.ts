// Traduz o `error_code` guardado em `bot_recovery_runs` para uma frase
// acionável em PT. Mesma divisão de trabalho de `clone-errors.ts`: o worker
// grava sempre o código cru (os logs mantêm o original), e a tradução vive só
// na UI — o operador não precisa decorar código nenhum.
//
// Diferente de `clone-errors.ts`, aqui o match é por chave exata: estes
// códigos são nossos, vêm de `RecoveryAttention(code)`, e não de uma string
// solta do Telegram.

const MENSAGENS: Record<string, string> = {
  // Plano, não defeito.
  healing_not_available:
    "A recuperação automática faz parte do plano premium. Enquanto a assinatura estiver inativa, ela fica parada — nada foi perdido, e tudo volta do ponto em que estava quando o premium voltar.",

  // Pré-requisitos que o próprio usuário resolve.
  identity_backup_missing:
    "Ainda não existe uma cópia da identidade deste bot (nome, descrição e foto). A cópia é feita automaticamente com a recuperação ligada e o bot no ar — deixe ligado e aguarde o próximo ciclo antes de contar com a recuperação.",
  mtproto_account_unavailable:
    "Nenhuma conta do Telegram disponível para falar com o BotFather. Conecte uma conta em Automações › Contas Telegram e selecione-a aqui.",
  mtproto_session_unavailable:
    "A sessão da conta do Telegram expirou ou foi revogada. Reconecte a conta em Automações › Contas Telegram.",
  mtproto_account_changed:
    "A conta do Telegram usada na recuperação mudou de estado no meio do processo. Reconecte a conta e tente de novo.",
  account_bot_limit:
    "Essa conta do Telegram já atingiu o limite de 20 bots do BotFather. Conecte outra conta e selecione-a aqui.",
  all_accounts_bot_limit:
    "Todas as contas selecionadas já atingiram o limite de 20 bots do BotFather. Conecte outra conta e selecione-a aqui.",
  account_restricted:
    "O Telegram restringiu essa conta (anti-spam), então o BotFather não responde a ela. Resolva no @SpamBot ou use outra conta.",
  profile_photo_too_large:
    "A foto de perfil do bot passa de 5 MB, acima do que conseguimos copiar e restaurar. Troque por uma imagem menor.",

  // Desfecho incerto: o passo não-idempotente. Nunca sugerir "tente de novo"
  // sem mandar conferir antes — repetir aqui cria um segundo bot e deixa um
  // órfão registrado na conta.
  creation_outcome_unknown:
    "O pedido de criação foi enviado, mas a resposta do BotFather não chegou — pode ter sobrado um bot criado. Abra o @BotFather e confira a lista de bots antes de tentar de novo; se o bot novo existir, apague-o lá primeiro.",
  creation_checkpoint_missing:
    "A recuperação perdeu a marcação de onde parou durante a criação. Abra o @BotFather e confira a lista de bots antes de tentar de novo.",

  // O BotFather mudou o roteiro: parar é o comportamento correto.
  botfather_identity_unverified:
    "O contato que respondeu não é o @BotFather verificado. A recuperação parou por segurança — não tente de novo sem falar com o suporte.",
  botfather_name_prompt_changed:
    "O @BotFather mudou o texto do passo de nome. A recuperação parou por segurança em vez de responder no escuro; avise o suporte.",
  botfather_username_prompt_changed:
    "O @BotFather mudou o texto do passo de username. A recuperação parou por segurança em vez de responder no escuro; avise o suporte.",
  botfather_creation_reply_changed:
    "O @BotFather respondeu à criação de um jeito que não reconhecemos. A recuperação parou por segurança; avise o suporte.",
  botfather_select_prompt_changed:
    "O @BotFather mudou o texto do passo de escolher o bot. A recuperação parou por segurança; avise o suporte.",
  botfather_profile_prompt_changed:
    "O @BotFather mudou o texto de um passo do perfil. A recuperação parou por segurança; avise o suporte.",
  botfather_profile_update_unconfirmed:
    "O @BotFather não confirmou a atualização do perfil do bot novo. A recuperação parou por segurança — confira o perfil do bot antes de seguir; avise o suporte.",

  // Bot novo saiu errado.
  replacement_token_missing:
    "A criação terminou sem devolver um token utilizável. Tente de novo; se repetir, confira a conta no @BotFather.",
  replacement_credential_invalid:
    "O token do bot novo não funcionou na primeira chamada ao Telegram. Nada foi trocado — tente de novo.",
  replacement_identity_mismatch:
    "O token recebido não corresponde ao bot que pedimos ao BotFather. Nada foi trocado, por segurança.",

  // Configuração do servidor, não do usuário.
  healing_credentials_missing:
    "O servidor de automações está sem as credenciais necessárias (TELEGRAM_API_ID, TELEGRAM_API_HASH ou GEMINI_API_KEY). Isso é configuração do servidor — avise o suporte.",

  // Estados normais, não falhas.
  credential_recovered:
    "O token do bot voltou a funcionar sozinho antes da troca. Nada foi alterado e o bot continua com as credenciais originais.",
  bot_changed:
    "O bot mudou durante a recuperação (token trocado na mão, bot desativado ou transferido), então a recuperação foi cancelada sem alterar nada.",
  retry_later:
    "O Telegram pediu para esperar antes da próxima tentativa. A recuperação retoma sozinha quando o tempo passar.",
  transient_failure:
    "Uma falha temporária interrompeu a tentativa. A recuperação tenta de novo sozinha.",
};

/**
 * Mensagem legível para o `error_code` de uma run de recuperação.
 * - null/vazio → null (nada a mostrar).
 * - código conhecido → frase em PT.
 * - desconhecido → o código cru (mostrar algo é melhor que esconder).
 */
export function friendlyHealingError(code: string | null | undefined): string | null {
  if (!code || !code.trim()) return null;
  return MENSAGENS[code.trim()] ?? code;
}
