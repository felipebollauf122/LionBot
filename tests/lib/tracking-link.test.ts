import { describe, it, expect } from "vitest";
import { buildTrackingParams, buildTrackingLink } from "@/lib/tracking-link";

describe("buildTrackingParams", () => {
  it("sem utmify e sem slug → só bot", () => {
    expect(buildTrackingParams("abc", false)).toBe("bot=abc");
  });

  it("com utmify → bot + UTMs da Meta", () => {
    const p = buildTrackingParams("abc", true);
    expect(p.startsWith("bot=abc&utm_source=FB")).toBe(true);
    expect(p).toContain("utm_campaign={{campaign.name}}|{{campaign.id}}");
    expect(p).not.toContain("&s="); // sem slug
  });

  it("com slug → entra como &s= no fim", () => {
    expect(buildTrackingParams("abc", false, "k7m2x9")).toBe("bot=abc&s=k7m2x9");
    expect(buildTrackingParams("abc", true, "k7m2x9")).toContain("&s=k7m2x9");
  });

  it("slug é url-encoded", () => {
    expect(buildTrackingParams("abc", false, "a b")).toBe("bot=abc&s=a%20b");
  });

  it("slug nulo/vazio não adiciona &s=", () => {
    expect(buildTrackingParams("abc", false, null)).toBe("bot=abc");
    expect(buildTrackingParams("abc", false, "")).toBe("bot=abc");
  });
});

describe("buildTrackingLink usa os mesmos params", () => {
  it("monta /t?<params> com o domínio", () => {
    expect(buildTrackingLink("abc", false, "https://x.com/", "k7m2x9")).toBe(
      "https://x.com/t?bot=abc&s=k7m2x9",
    );
  });
});
