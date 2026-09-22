import { describe, it, expect, vi } from "vitest";
import {
  CampaignRunner,
  type CampaignTargetRow,
  type RunnerDeps,
} from "../../src/services/mtproto/campaign-runner.js";
import { AccountPool, type PoolAccount } from "../../src/services/mtproto/pool.js";
import { FloodWaitError } from "telegram/errors/index.js";

function pool(...ids: string[]): AccountPool {
  const p = new AccountPool();
  p.load(
    ids.map(
      (id): PoolAccount => ({
        id,
        phoneNumber: `+${id}`,
        sessionString: `s-${id}`,
        status: "active",
        floodWaitUntil: null,
      }),
    ),
  );
  return p;
}

function targets(
  ...items: Array<{ id: string; identifier: string; type: "username" | "phone"; pinnedAccountId?: string }>
): CampaignTargetRow[] {
  return items.map((i) => ({
    id: i.id,
    identifier: i.identifier,
    type: i.type,
    status: "pending",
    ...(i.pinnedAccountId ? { pinnedAccountId: i.pinnedAccountId } : {}),
  }));
}

function makeDeps(
  overrides: Partial<RunnerDeps> = {},
): RunnerDeps & { sends: Array<{ accountId: string; target: string }> } {
  const sends: Array<{ accountId: string; target: string }> = [];
  const base: RunnerDeps = {
    sendMessage: async (accountId, target) => {
      sends.push({ accountId, target: target.identifier });
    },
    markTargetSent: vi.fn(async () => {}),
    markTargetFailed: vi.fn(async () => {}),
    setCampaignStatus: vi.fn(async () => {}),
    getCampaignStatus: vi.fn(async () => "running"),
    delay: async () => {},
    ...overrides,
  };
  return Object.assign(base, { sends });
}

const cfg = { campaignId: "c1", messageText: "x", delayMinSeconds: 0, delayMaxSeconds: 0 };
const rpc = (code: string, status = 400) =>
  new Error(`${status}: ${code} (caused by messages.SendMessage)`);

describe("CampaignRunner", () => {
  it.each(["PEER_FLOOD", "TIMEOUT", "FLOOD_WAIT_86400"])("%s usa o intervalo configurado, sem espera artificial", async code => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const deps = makeDeps({ sendMessage: async () => {
        if (code === "FLOOD_WAIT_86400") throw new FloodWaitError({ request: undefined as never, capture: 86400 } as never);
        throw rpc(code);
      }, deferCampaign: vi.fn(async () => {}), deferAccount: vi.fn(async () => {}), markTargetRetryAfter: vi.fn(async () => {}) });
      await new CampaignRunner(pool("a"), deps, { ...cfg, delayMinSeconds: 5, delayMaxSeconds: 5, recurrenceSeconds: 86400 }).run(targets({ id: "t1", identifier: "u", type: "username" }));
      expect(deps.deferCampaign).toHaveBeenCalledWith(new Date(now + 5000).toISOString(), code === "TIMEOUT" ? "CONNECTION_RETRY" : code);
      expect(deps.markTargetRetryAfter).toHaveBeenCalledWith("t1", new Date(now + 5000).toISOString(), code === "TIMEOUT" ? "CONNECTION_RETRY" : code);
    } finally { clock.mockRestore(); }
  });
  it("aguarda apenas entre envios, sem acrescentar espera ao fim do ciclo", async () => {
    const delay = vi.fn(async () => {});
    await new CampaignRunner(pool("a"), makeDeps({ delay }), { ...cfg, delayMinSeconds: 2, delayMaxSeconds: 2 }).run(targets({ id: "t1", identifier: "u", type: "username" }, { id: "t2", identifier: "v", type: "username" }));
    expect(delay.mock.calls).toEqual([[2000]]);
  });
  it("usa a mensagem editada antes do próximo envio", async () => {
    const live = { ...cfg };
    const sendMessage = vi.fn<RunnerDeps["sendMessage"]>(async () => { live.messageText = "editada"; });
    await new CampaignRunner(pool("a"), makeDeps({ sendMessage }), live).run(targets({ id: "t1", identifier: "u", type: "username" }, { id: "t2", identifier: "v", type: "username" }));
    expect(sendMessage.mock.calls[1]?.[2]).toBe("editada");
  });
  it("aguarda conta indisponível sem falhar o destino nem pausar a intenção do usuário", async () => {
    const deferCampaign = vi.fn(async () => {});
    const deps = makeDeps({ deferCampaign, markTargetRetryAfter: vi.fn(async () => {}) });
    await new CampaignRunner(pool(), deps, cfg).run(targets({ id: "t1", identifier: "u", type: "username", pinnedAccountId: "a" }));
    expect(deferCampaign).toHaveBeenCalledWith(expect.any(String), "ACCOUNT_UNAVAILABLE");
    expect(deps.markTargetFailed).not.toHaveBeenCalled();
    expect(deps.setCampaignStatus).not.toHaveBeenCalledWith("c1", "completed");
    expect(deps.setCampaignStatus).not.toHaveBeenCalledWith("c1", "paused");
  });

  it.each(["PEER_FLOOD", "TIMEOUT"])("%s preserva o destino para retomada e não insiste nos demais", async (code) => {
    const deferCampaign = vi.fn(async () => {});
    const deferAccount = vi.fn(async () => {});
    const sendMessage = vi.fn(async () => { throw rpc(code); });
    const deps = makeDeps({ deferCampaign, deferAccount, sendMessage, markTargetRetryAfter: vi.fn(async () => {}) });
    await new CampaignRunner(pool("a"), deps, cfg).run(targets({ id: "t1", identifier: "u", type: "username" }, { id: "t2", identifier: "v", type: "username" }));
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(deps.markTargetFailed).not.toHaveBeenCalled();
    expect(deps.markTargetRetryAfter).toHaveBeenCalledWith("t1", expect.any(String), code === "PEER_FLOOD" ? "PEER_FLOOD" : "CONNECTION_RETRY");
    expect(deferCampaign).toHaveBeenCalledOnce();
    expect(deps.setCampaignStatus).not.toHaveBeenCalledWith("c1", "completed");
    if (code === "PEER_FLOOD") expect(deferAccount).toHaveBeenCalledOnce();
  });

  it("não conclui nem reinicia o ciclo enquanto há destinos aguardando retry_after", async () => {
    const deps = makeDeps({ hasPendingTargets: async () => true, deferCampaign: vi.fn(async () => {}) });
    await new CampaignRunner(pool("a"), deps, cfg).run([]);
    expect(deps.deferCampaign).toHaveBeenCalledOnce();
    expect(deps.setCampaignStatus).not.toHaveBeenCalledWith("c1", "completed");
  });

  it("job antigo não reativa uma campanha pausada pelo usuário", async () => {
    const deps = makeDeps({ getCampaignStatus: async () => "paused" });
    await new CampaignRunner(pool("a"), deps, cfg).run(targets({ id: "t1", identifier: "u", type: "username" }));
    expect(deps.setCampaignStatus).not.toHaveBeenCalled();
    expect(deps.sends).toHaveLength(0);
  });
  it("sends to all pending targets distributing across the pool", async () => {
    const deps = makeDeps();
    const runner = new CampaignRunner(pool("a", "b"), deps, { ...cfg, messageText: "oi" });
    await runner.run(
      targets(
        { id: "t1", identifier: "u1", type: "username" },
        { id: "t2", identifier: "u2", type: "username" },
        { id: "t3", identifier: "u3", type: "username" },
      ),
    );
    expect(deps.sends.map((s) => s.accountId)).toEqual(["a", "b", "a"]);
    expect(deps.markTargetSent).toHaveBeenCalledTimes(3);
  });

  it("on FloodWaitError marks the account and reuses another", async () => {
    const pl = pool("a", "b");
    const deps = makeDeps({
      sendMessage: async (accountId: string) => {
        if (accountId === "a") {
          const e = Object.assign(new Error("FLOOD_WAIT"), { seconds: 30 });
          throw e;
        }
      },
    });
    const runner = new CampaignRunner(pl, deps, cfg);
    await runner.run(targets({ id: "t1", identifier: "u1", type: "username" }));
    expect(deps.markTargetSent).toHaveBeenCalledWith("t1", "b");
  });

  it("marks target failed for non-retryable errors", async () => {
    const deps = makeDeps({
      sendMessage: async () => {
        throw new Error("USERNAME_NOT_OCCUPIED");
      },
    });
    const runner = new CampaignRunner(pool("a"), deps, cfg);
    await runner.run(targets({ id: "t1", identifier: "bad", type: "username" }));
    expect(deps.markTargetFailed).toHaveBeenCalledWith(
      "t1",
      "a",
      expect.stringContaining("USERNAME_NOT_OCCUPIED"),
    );
  });

  it("pauses campaign when no accounts are available", async () => {
    const p = new AccountPool();
    p.load([]);
    const deps = makeDeps();
    const runner = new CampaignRunner(p, deps, cfg);
    await runner.run(targets({ id: "t1", identifier: "u", type: "username" }));
    expect(deps.setCampaignStatus).toHaveBeenCalledWith("c1", "paused");
  });

  it("completes the campaign when all targets are sent", async () => {
    const deps = makeDeps();
    const runner = new CampaignRunner(pool("a"), deps, cfg);
    await runner.run(targets({ id: "t1", identifier: "u", type: "username" }));
    expect(deps.setCampaignStatus).toHaveBeenCalledWith("c1", "completed");
  });

  it("USER_DEACTIVATED (sessão morta) marca a conta como fatal", async () => {
    const markAccountFatal = vi.fn(async () => {});
    const deps = makeDeps({
      markAccountFatal,
      sendMessage: async () => {
        throw rpc("USER_DEACTIVATED", 401);
      },
    });
    const runner = new CampaignRunner(pool("a"), deps, cfg);
    await runner.run(targets({ id: "t1", identifier: "u", type: "username" }));
    expect(markAccountFatal).toHaveBeenCalledWith("a", expect.stringContaining("USER_DEACTIVATED"));
  });

  describe("recusa permanente do destino (alvo pulado)", () => {
    it.each([
      "CHAT_ADMIN_REQUIRED",
      "CHAT_WRITE_FORBIDDEN",
      "USER_BANNED_IN_CHANNEL",
      "CHAT_RESTRICTED",
      "CHANNEL_PRIVATE",
      "PEER_ID_INVALID",
      "TOPIC_CLOSED",
      "CHAT_SEND_PLAIN_FORBIDDEN",
    ])("%s pula o alvo com o código como motivo, sem marcar falha", async (code) => {
      const skipTarget = vi.fn(async () => {});
      const deps = makeDeps({
        skipTarget,
        sendMessage: async () => {
          throw rpc(code);
        },
      });
      const runner = new CampaignRunner(pool("a"), deps, cfg);
      await runner.run(targets({ id: "t1", identifier: "canal_x", type: "username" }));

      expect(skipTarget).toHaveBeenCalledWith("t1", expect.objectContaining({ id: "t1" }), code);
      expect(deps.markTargetFailed).not.toHaveBeenCalled();
    });

    it("não derruba a campanha: os alvos seguintes continuam recebendo", async () => {
      const deps = makeDeps({
        skipTarget: vi.fn(async () => {}),
        sendMessage: async (accountId, target) => {
          if (target.identifier === "morto") throw rpc("CHAT_ADMIN_REQUIRED");
          deps.sends.push({ accountId, target: target.identifier });
        },
      });
      const runner = new CampaignRunner(pool("a"), deps, cfg);
      await runner.run(
        targets(
          { id: "t1", identifier: "vivo1", type: "username" },
          { id: "t2", identifier: "morto", type: "username" },
          { id: "t3", identifier: "vivo2", type: "username" },
        ),
      );

      expect(deps.sends.map((s) => s.target)).toEqual(["vivo1", "vivo2"]);
      expect(deps.markTargetSent).toHaveBeenCalledTimes(2);
      expect(deps.setCampaignStatus).toHaveBeenCalledWith("c1", "completed");
    });

    it("INPUT_USER_DEACTIVATED é o CONTATO desativado: pula o alvo e NÃO bane a conta", async () => {
      const skipTarget = vi.fn(async () => {});
      const markAccountFatal = vi.fn(async () => {});
      const deps = makeDeps({
        skipTarget,
        markAccountFatal,
        sendMessage: async () => {
          throw rpc("INPUT_USER_DEACTIVATED");
        },
      });
      const runner = new CampaignRunner(pool("a"), deps, cfg);
      await runner.run(targets({ id: "t1", identifier: "u", type: "username" }));

      expect(skipTarget).toHaveBeenCalledWith("t1", expect.anything(), "INPUT_USER_DEACTIVATED");
      expect(markAccountFatal).not.toHaveBeenCalled();
    });

    it("recusa na conta reserva (depois de flood na primeira) também pula", async () => {
      const skipTarget = vi.fn(async () => {});
      const deps = makeDeps({
        skipTarget,
        sendMessage: async (accountId: string) => {
          if (accountId === "a") throw Object.assign(new Error("FLOOD_WAIT"), { seconds: 30 });
          throw rpc("CHAT_WRITE_FORBIDDEN", 403);
        },
      });
      const runner = new CampaignRunner(pool("a", "b"), deps, cfg);
      await runner.run(targets({ id: "t1", identifier: "u", type: "username" }));

      expect(skipTarget).toHaveBeenCalledWith("t1", expect.anything(), "CHAT_WRITE_FORBIDDEN");
      expect(deps.markTargetFailed).not.toHaveBeenCalled();
    });

    // Guarda de regressão: só recusa PERMANENTE some da campanha. Erro
    // genérico continua falha visível na tela.
    it("qualquer OUTRO erro continua virando falha visível", async () => {
      const skipTarget = vi.fn(async () => {});
      const deps = makeDeps({
        skipTarget,
        sendMessage: async () => {
          throw new Error("500: INTERNAL (caused by messages.SendMessage)");
        },
      });
      const runner = new CampaignRunner(pool("a"), deps, cfg);
      await runner.run(targets({ id: "t1", identifier: "u", type: "username" }));

      expect(skipTarget).not.toHaveBeenCalled();
      expect(deps.markTargetFailed).toHaveBeenCalledWith("t1", "a", expect.stringContaining("INTERNAL"));
    });

    it("sem a dep skipTarget, cai no caminho antigo de falha", async () => {
      const deps = makeDeps({
        sendMessage: async () => {
          throw rpc("CHAT_SEND_PLAIN_FORBIDDEN", 403);
        },
      });
      const runner = new CampaignRunner(pool("a"), deps, cfg);
      await runner.run(targets({ id: "t1", identifier: "u", type: "username" }));

      expect(deps.markTargetFailed).toHaveBeenCalledWith(
        "t1",
        "a",
        expect.stringContaining("CHAT_SEND_PLAIN_FORBIDDEN"),
      );
    });
  });
});
