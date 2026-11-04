import { AppShell } from "@/components/app-shell";
import { AccessWorkspace } from "@/components/access-workspace";
import { requireIdentity } from "@/lib/require-identity";

export default async function AccessPage() {
  const identity = await requireIdentity("/admin/access");
  return <AppShell role={identity.role} userName={identity.name}>{identity.role === "admin" ? <AccessWorkspace /> : <section className="p-6">This content is unavailable.</section>}</AppShell>;
}
