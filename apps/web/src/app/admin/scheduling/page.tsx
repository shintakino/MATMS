import { AppShell } from "@/components/app-shell";
import { SchedulingAdmin } from "@/components/scheduling-admin";
import { requireIdentity } from "@/lib/require-identity";
import { redirect } from "next/navigation";

export default async function Page() {
  const identity = await requireIdentity("/admin/scheduling");
  if (!["admin"].includes(identity.role)) redirect("/dashboard");
  return <AppShell role={identity.role} userName={identity.name}><SchedulingAdmin /></AppShell>;
}
