# Postagem automática por acervo

Implementação em `/dashboard/automations/scheduled`. As campanhas manuais anteriores continuam em `/dashboard/automations/scheduled/campaigns`; suas URLs de edição e seus dados foram preservados.

## Uso

1. Conecte uma conta Telegram e sincronize os canais/grupos. Adicione o bot de publicação ao destino com permissão para publicar.
2. Crie a automação escolhendo o destino. Ela começa pausada e no modo de revisão.
3. Em **Origens**, escolha importar histórico, escutar novas postagens, ou ambos. A origem pode ser de terceiros, desde que a conta tenha acesso ao conteúdo.
4. Em **Regras do Gemini**, salve instruções, substituições de texto/links, botões, assinatura, tipos permitidos, formato das mídias e modo de envio.
5. Ative a automação. Em **Acervo**, consulte originais, revise mensagens ou reutilize conteúdo. Em **Fila de publicação**, acompanhe agendamentos e resultados.

As regras do Gemini suportam texto/legenda, botões HTTP(S), descarte, atraso em segundos, data ISO com fuso e envio em álbum ou separado. O modelo não recebe os arquivos para interpretação visual. No modo de revisão, nenhuma decisão da IA autoriza publicação automática.

Salve as regras antes de reprocessar os rascunhos existentes. Mensagens já enfileiradas mantêm o tratamento salvo; abra o item para retirá-lo da fila e reprocessar. Reutilizar um item enviado prepara uma nova publicação, não edita a mensagem anterior no Telegram.

## Arquitetura e limites

- Originais e procedência são imutáveis no banco. A versão tratada é independente.
- Mídias são copiadas para o bucket existente `media`, sob `tenant/library/source/`. Esse bucket usa URLs públicas; trate links compartilhados como acesso ao arquivo. Não há expiração automática.
- O histórico usa um limite superior fixado ao iniciar. A escuta tem cursor e lease próprios, independentemente da importação.
- Eventos Telegram antecipam a coleta, com um pequeno buffer para álbuns; há consulta periódica de recuperação a cada cinco segundos. Novas postagens têm prioridade de tratamento. Não é uma garantia de latência zero: Gemini, download/upload e limites Telegram influenciam o tempo.
- Arquivos de até 50 MB são aceitos pelo importador. Arquivos acima do teto interrompem aquela origem com erro explícito e cursor preservado. Limites específicos de formato do Telegram continuam se aplicando ao envio.
- Mensagens de serviço são ignoradas. Tipos não suportados ficam registrados como filtrados; não são convertidos silenciosamente em conteúdo vazio.
- Álbuns preservam todos os originais e possuem um item principal para tratamento/publicação. Botões de álbuns e enquetes são enviados numa mensagem complementar configurável, pois [sendMediaGroup não possui reply_markup](https://core.telegram.org/bots/api#sendmediagroup).
- Conteúdo já arquivado pode ser publicado mesmo quando a origem deixa de estar disponível. Pausar explicitamente uma origem também pausa o tratamento/envio dos seus itens.
- A fila utiliza reivindicação transacional por bot/usuário. Cada etapa de envio confirmada possui recibo; uma retomada não repete as etapas já confirmadas.
- Timeout ou perda de resposta após iniciar uma chamada mantém o item em `sending`. A fila desse usuário é bloqueada para evitar duplicação. Pause a automação, confira o destino e use a conferência manual do item após cinco minutos. Liberar uma etapa não confirmada pode duplicá-la se o Telegram a recebeu sem devolver resposta.
- Não há exclusão automática de publicações ou reenvio automático de erros desconhecidos.

## Instalação

Aplicar `supabase/migrations/077_automation_libraries.sql` após as migrações anteriores e publicar o Next e o worker a partir do código atualizado.

O worker precisa das configurações já usadas pelo projeto: `SUPABASE_URL`, chave de serviço, `MTPROTO_WORKER_ENABLED`, `TELEGRAM_API_ID` e `TELEGRAM_API_HASH`. Para IA, também `GEMINI_API_KEY` e `GEMINI_MODEL`. O worker inicia junto do servidor, respeitando a flag MTProto. Confira os nomes completos em `server/src/config.ts` e o arquivo de exemplo do ambiente do deploy.

Nenhuma migração foi aplicada ao banco remoto nem foram enviados posts reais durante esta implementação.

## Verificação

- `npm test` e `npm run build` na raiz.
- `npm test` e `npx tsc --noEmit` em `server`.
- Contrato SQL exercitado em PostgreSQL 16 isolado com `server/tests/sql/library-bootstrap.sql`, migração 077 e `server/tests/sql/library-contract.sql`, nesta ordem. **O bootstrap é exclusivo para banco descartável, nunca para produção.**
- Testes dedicados cobrem transformação, isolamento, preservação de originais, histórico/escuta, retomada parcial e recuperação manual.
- Validação real de permissões Telegram, credenciais Gemini, Storage e visualização no navegador deve ser feita no ambiente de uso antes de ativar publicação imediata.

## Correções no clonador anterior

A retomada usa o cursor persistido e o mapa completo paginado. Erros de gravação não são ignorados; o limite das últimas mensagens é fixado na primeira execução; o destino existente pode recuperar seu convite. Uma execução sem nenhuma cópia e com falhas não é apresentada como concluída. A tela volta a consultar o progresso após retomar e atualiza o relatório quando mudam falhas ou itens pulados.

A retomada continua a partir do cursor: ela não refaz automaticamente mensagens já registradas como falhas. Revise os motivos antes de iniciar uma nova clonagem.
