import { describe, it, expect } from "vitest";
import { deriveDestKind, isClonableKind } from "@/lib/mtproto/clone-kind";

describe("deriveDestKind", () => {
  it.each([
    ["channel_owner", "broadcast"],
    ["channel_subscriber", "broadcast"],
    ["group_admin", "megagroup"],
    ["group_member", "megagroup"],
  ])("%s vira %s", (kind, expected) => {
    expect(deriveDestKind(kind)).toBe(expected);
  });

  it("recusa kind que não é canal nem grupo", () => {
    expect(() => deriveDestKind("bot")).toThrow(/DIALOG_KIND_NAO_CLONAVEL/);
  });
});

describe("isClonableKind", () => {
  it("aceita canal e grupo, recusa o resto", () => {
    expect(isClonableKind("channel_subscriber")).toBe(true);
    expect(isClonableKind("group_member")).toBe(true);
    expect(isClonableKind("bot")).toBe(false);
    expect(isClonableKind("contact")).toBe(false);
    expect(isClonableKind("dm")).toBe(false);
    expect(isClonableKind("self")).toBe(false);
  });
});
