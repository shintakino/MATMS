import { AppShell } from "@/components/app-shell";
import { AuditWorkspace } from "@/components/audit-workspace";
import { requireIdentity } from "@/lib/require-identity";

export default async function AuditPage() {
  const identity = await requireIdentity("/admin/audit");
  return <AppShell role={identity.role} userName={identity.name}>{identity.role === "admin" ? <AuditWorkspace /> : <section className="p-6">This content is unavailable.</section>}</AppShell>;
}
