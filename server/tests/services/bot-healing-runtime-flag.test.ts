import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/config.js", () => ({ config: { botAutoHealEnabled: false, redisUrl: "redis://x" } }));
vi.mock("../../src/db.js", () => ({ supabase: { from: vi.fn() } }));

import { isBotHealingRunning, startBotHealing } from "../../src/services/bot-healing/runtime.js";

describe("recuperação de bots no /health", () => {
  // O /health existe para responder de fora "a VPS ja esta rodando o codigo
  // novo?". Mas `mtproto` e `library` respondem true tambem na imagem antiga,
  // porque sao anteriores a esta feature — sem sinal proprio, a unica forma de
  // saber se a recuperacao ligou era ler log de boot dentro da maquina.
  it("responde false enquanto o worker não subiu", () => {
    expect(isBotHealingRunning()).toBe(false);
  });

  // Com BOT_AUTO_HEAL_ENABLED=false, `startBotHealing` retorna na primeira
  // linha. O booleano precisa refletir o PROCESSO, nao a intencao do env: dizer
  // true aqui mandaria o operador procurar defeito onde so falta a variavel.
  it("não promete estar rodando quando a feature está desligada no env", async () => {
    await startBotHealing();
    expect(isBotHealingRunning()).toBe(false);
  });
});
