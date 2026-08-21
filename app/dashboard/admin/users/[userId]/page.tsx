import { redirect, notFound } from "next/navigation";
import { isAdmin, getAdminUserProfile, getAdminUserBots, getViewableUsers } from "@/lib/actions/admin-actions";
import { AdminUserProfile } from "@/components/dashboard/admin-user-profile";

export default async function AdminUserProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const admin = await isAdmin();
  if (!admin) redirect("/dashboard");

  const { userId } = await params;
  const user = await getAdminUserProfile(userId);
  if (!user) notFound();

  // `users` alimenta o seletor de destino da transferência de bot.
  const [bots, users] = await Promise.all([getAdminUserBots(userId), getViewableUsers()]);

  return (
    <div className="p-8 max-w-5xl">
      <div className="animate-up">
        <AdminUserProfile user={user} bots={bots} users={users} />
      </div>
    </div>
  );
}
