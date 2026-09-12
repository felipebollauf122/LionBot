import { describe, it, expect, vi } from "vitest";
import {
  CampaignRunner,
  type CampaignTargetRow,
  type RunnerDeps,
} from "../../src/services/mtproto/campaign-runner.js";
import { AccountPool, type PoolAccount } from "../../src/services/mtproto/pool.js";

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
  ...items: Array<{ id: string; identifier: string; type: "username" | "phone" }>
): CampaignTargetRow[] {
  return items.map((i) => ({ id: i.id, identifier: i.identifier, type: i.type, status: "pending" }));
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
    incrementCounters: vi.fn(async () => {}),
    setCampaignStatus: vi.fn(async () => {}),
    getCampaignStatus: vi.fn(async () => "running"),
    delay: async () => {},
    ...overrides,
  };
  return Object.assign(base, { sends });
}

describe("CampaignRunner", () => {
  it("sends to all pending targets distributing across the pool", async () => {
    const deps = makeDeps();
    const runner = new CampaignRunner(pool("a", "b"), deps, {
      campaignId: "c1",
      messageText: "oi",
      delayMinSeconds: 0,
      delayMaxSeconds: 0,
    });
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
    const runner = new CampaignRunner(pl, deps, {
      campaignId: "c1",
      messageText: "x",
      delayMinSeconds: 0,
      delayMaxSeconds: 0,
    });
    await runner.run(targets({ id: "t1", identifier: "u1", type: "username" }));
    expect(deps.markTargetSent).toHaveBeenCalledWith("t1", "b");
  });

  it("marks target failed for non-retryable errors", async () => {
    const deps = makeDeps({
      sendMessage: async () => {
        throw new Error("USERNAME_NOT_OCCUPIED");
      },
    });
    const runner = new CampaignRunner(pool("a"), deps, {
      campaignId: "c1",
      messageText: "x",
      delayMinSeconds: 0,
      delayMaxSeconds: 0,
    });
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
    const runner = new CampaignRunner(p, deps, {
      campaignId: "c1",
      messageText: "x",
      delayMinSeconds: 0,
      delayMaxSeconds: 0,
    });
    await runner.run(targets({ id: "t1", identifier: "u", type: "username" }));
    expect(deps.setCampaignStatus).toHaveBeenCalledWith("c1", "paused");
  });

  it("completes the campaign when all targets are sent", async () => {
    const deps = makeDeps();
    const runner = new CampaignRunner(pool("a"), deps, {
      campaignId: "c1",
      messageText: "x",
      delayMinSeconds: 0,
      delayMaxSeconds: 0,
    });
    await runner.run(targets({ id: "t1", identifier: "u", type: "username" }));
    expect(deps.setCampaignStatus).toHaveBeenCalledWith("c1", "completed");
  });

  describe("CHAT_SEND_PLAIN_FORBIDDEN", () => {
    const plainForbidden = () =>
      new Error("403: CHAT_SEND_PLAIN_FORBIDDEN (caused by messages.SendMessage)");

    it("apaga o alvo em vez de marcar falha, e não conta no failed_count", async () => {
      const dropTarget = vi.fn(async () => {});
      const deps = makeDeps({
        dropTarget,
        sendMessage: async (_accountId, target) => {
          if (target.identifier === "grupo_sem_texto") throw plainForbidden();
        },
      });
      const runner = new CampaignRunner(pool("a"), deps, {
        campaignId: "c1",
        messageText: "x",
        delayMinSeconds: 0,
        delayMaxSeconds: 0,
      });
      await runner.run(targets({ id: "t1", identifier: "grupo_sem_texto", type: "username" }));

      expect(dropTarget).toHaveBeenCalledWith("t1", expect.objectContaining({ id: "t1" }));
      expect(deps.markTargetFailed).not.toHaveBeenCalled();
      expect(deps.incrementCounters).not.toHaveBeenCalledWith("c1", "failed");
    });

    it("não derruba a campanha: os alvos seguintes continuam recebendo", async () => {
      const deps = makeDeps({
        dropTarget: vi.fn(async () => {}),
        sendMessage: async (accountId, target) => {
          if (target.identifier === "morto") throw plainForbidden();
          deps.sends.push({ accountId, target: target.identifier });
        },
      });
      const runner = new CampaignRunner(pool("a"), deps, {
        campaignId: "c1",
        messageText: "x",
        delayMinSeconds: 0,
        delayMaxSeconds: 0,
      });
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

    // O pedido era explícito: SÓ esse código some. Guarda de regressão pra
    // ninguém alargar o detector depois e engolir falha de verdade.
    it("qualquer OUTRO erro continua virando falha visível", async () => {
      const dropTarget = vi.fn(async () => {});
      const deps = makeDeps({
        dropTarget,
        sendMessage: async () => {
          throw new Error("403: CHAT_WRITE_FORBIDDEN (caused by messages.SendMessage)");
        },
      });
      const runner = new CampaignRunner(pool("a"), deps, {
        campaignId: "c1",
        messageText: "x",
        delayMinSeconds: 0,
        delayMaxSeconds: 0,
      });
      await runner.run(targets({ id: "t1", identifier: "u", type: "username" }));

      expect(dropTarget).not.toHaveBeenCalled();
      expect(deps.markTargetFailed).toHaveBeenCalledWith(
        "t1",
        "a",
        expect.stringContaining("CHAT_WRITE_FORBIDDEN"),
      );
      expect(deps.incrementCounters).toHaveBeenCalledWith("c1", "failed");
    });

    it("sem a dep dropTarget, cai no caminho antigo de falha", async () => {
      const deps = makeDeps({
        sendMessage: async () => {
          throw plainForbidden();
        },
      });
      const runner = new CampaignRunner(pool("a"), deps, {
        campaignId: "c1",
        messageText: "x",
        delayMinSeconds: 0,
        delayMaxSeconds: 0,
      });
      await runner.run(targets({ id: "t1", identifier: "u", type: "username" }));

      expect(deps.markTargetFailed).toHaveBeenCalledWith(
        "t1",
        "a",
        expect.stringContaining("CHAT_SEND_PLAIN_FORBIDDEN"),
      );
    });
  });
});
