import { describe, expect, it } from "vitest";
import { automationHref, automationSectionForPath } from "@/lib/automations/navigation";

describe("navigation within automations", () => {
  it.each([
    ["/dashboard/automations", "overview"],
    ["/dashboard/automations/scheduled/new", "scheduled"],
    ["/dashboard/automations/clones/clone-1", "clones"],
    ["/dashboard/automations/botclones/clone-1", "botclones"],
    ["/dashboard/automations/accounts/account-1/inbox", "accounts"],
    ["/dashboard/automations/new-campaign", "campaigns"],
  ])("keeps the owning section active at %s", (path, section) => {
    expect(automationSectionForPath(path).id).toBe(section);
  });

  it("carries a selected tenant through list, detail and creation links", () => {
    expect(automationHref("/dashboard/automations/scheduled", "tenant-1")).toBe("/dashboard/automations/scheduled?view=tenant-1");
    expect(automationHref("/dashboard/automations/clones/new?dialogId=d1", "tenant-1")).toBe("/dashboard/automations/clones/new?dialogId=d1&view=tenant-1");
    expect(automationHref("/dashboard/automations/accounts", "all")).toBe("/dashboard/automations/accounts?view=all");
  });

  it("does not imply cross-tenant monitoring, whose API only supports the current owner", () => {
    expect(automationHref("/dashboard/automations/channel-monitors", "tenant-1")).toBe("/dashboard/automations/channel-monitors");
  });

  it("uses the default scope without a redundant query", () => {
    expect(automationHref("/dashboard/automations/scheduled", "mine")).toBe("/dashboard/automations/scheduled");
  });
});
