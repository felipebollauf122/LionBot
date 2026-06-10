import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("role, is_owner")
    .eq("id", user.id)
    .single();

  return (
    <div className="relative">
      {/* Ambient background effects */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-0 left-[30%] w-[600px] h-[400px] bg-(--accent) rounded-full opacity-[0.015] blur-[180px]" />
        <div className="absolute bottom-0 right-[20%] w-[500px] h-[300px] bg-(--cyan) rounded-full opacity-[0.01] blur-[150px]" />
      </div>
      <DashboardShell isAdmin={tenant?.role === "admin"} isOwner={tenant?.is_owner === true}>
        {children}
      </DashboardShell>
    </div>
  );
}
