import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/dashboard/sidebar";

const navigation = vi.hoisted(() => ({ view: "naves" }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams({ view: navigation.view }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

describe("entrada nas automações pelo menu lateral", () => {
  it.each(["naves", "all"])("preserva a visão %s selecionada no painel", (view) => {
    navigation.view = view;
    render(<Sidebar isAdmin isOwner />);
    expect(screen.getByRole("link", { name: "Automações" })).toHaveAttribute("href", `/dashboard/automations?view=${view}`);
  });

  it("a visão Minha continua entrando nas próprias automações", () => {
    navigation.view = "mine";
    render(<Sidebar isAdmin isOwner />);
    expect(screen.getByRole("link", { name: "Automações" })).toHaveAttribute("href", "/dashboard/automations");
  });

  it("não propaga uma visão de outro usuário para quem não é admin", () => {
    navigation.view = "naves";
    render(<Sidebar isPremium />);
    expect(screen.getByRole("link", { name: "Automações" })).toHaveAttribute("href", "/dashboard/automations");
  });
});
