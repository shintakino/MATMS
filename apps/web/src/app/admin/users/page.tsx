import { redirect } from "next/navigation";
import type { Route } from "next";

import { AppShell } from "@/components/app-shell";
import { AdminUserManagement } from "@/components/admin-user-management";
import { client } from "@/utils/orpc";

export default async function UserAdministrationPage() {
  let identity: Awaited<ReturnType<typeof client.identity.me>>;
  try {
    identity = await client.identity.me();
  } catch {
    redirect("/login?returnTo=%2Fadmin%2Fusers" as Route);
  }

  if (identity.mustChangePassword || identity.role !== "admin") {
    redirect("/dashboard" as Route);
  }

  return (
    <AppShell role={identity.role} userName={identity.name}>
      <AdminUserManagement />
    </AppShell>
  );
}
