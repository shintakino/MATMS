import { redirect } from "next/navigation";
import type { Route } from "next";

import { AppShell } from "@/components/app-shell";
import { AdminUserManagement } from "@/components/admin-user-management";
import { requireIdentity } from "@/lib/require-identity";

export default async function UserAdministrationPage() {
  const identity = await requireIdentity("/admin/users");

  if (identity.mustChangePassword || identity.role !== "admin") {
    redirect("/dashboard" as Route);
  }

  return (
    <AppShell role={identity.role} userName={identity.name}>
      <AdminUserManagement />
    </AppShell>
  );
}
