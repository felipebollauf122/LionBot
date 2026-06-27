import { describe, it, expect } from "vitest";
import { parseAsField, isPublicIp } from "@/lib/traffic-filter/asn-lookup";

describe("parseAsField", () => {
  it("extrai o ASN do campo as do ip-api", () => {
    expect(parseAsField("AS15169 Google LLC")).toBe("AS15169");
    expect(parseAsField("AS16509 Amazon.com, Inc.")).toBe("AS16509");
  });
  it("retorna undefined para vazio", () => {
    expect(parseAsField("")).toBeUndefined();
    expect(parseAsField("   ")).toBeUndefined();
  });
});

describe("isPublicIp", () => {
  it("rejeita privados/loopback/vazio", () => {
    expect(isPublicIp("127.0.0.1")).toBe(false);
    expect(isPublicIp("10.0.0.5")).toBe(false);
    expect(isPublicIp("192.168.1.1")).toBe(false);
    expect(isPublicIp("")).toBe(false);
  });
  it("aceita IP público", () => {
    expect(isPublicIp("203.0.113.9")).toBe(true);
  });
});
