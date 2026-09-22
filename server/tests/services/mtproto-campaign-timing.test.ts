import { describe, expect, it } from "vitest";
import { nextCampaignRun } from "../../src/services/mtproto/campaign-timing.js";

describe("intervalo dos ciclos", () => {
  const start = "2026-09-22T12:00:00.000Z";
  it("desconta o tempo que o ciclo já levou", () => {
    expect(nextCampaignRun(start, 10, Date.parse(start) + 4000)).toBe("2026-09-22T12:00:10.000Z");
  });
  it("libera imediatamente quando o ciclo excede o intervalo", () => {
    expect(nextCampaignRun(start, 3, Date.parse(start) + 8000)).toBe("2026-09-22T12:00:08.000Z");
  });
});
