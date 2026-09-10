import { vi } from "vitest";

// server/src/config.ts asserts these env vars exist at module-import time
// (via env(), not envOptional()). Any test whose import graph reaches
// src/config.ts — e.g. through an engine node — would otherwise blow up
// before a single test runs. These are dummy, non-production placeholder
// values used only to satisfy the assertion; real values live in
// server/.env and are never read here. Set them only if not already
// present so a real env (e.g. from a local .env loaded by the runner)
// takes precedence.
process.env.SUPABASE_URL ??= "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.BASE_WEBHOOK_URL ??= "https://test.example.com";

// Global mock for Supabase client
vi.mock("../src/db", () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));
