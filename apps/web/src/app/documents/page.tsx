import { AppShell } from "@/components/app-shell";
import { DocumentRegister } from "@/components/archive-register";
import { requireIdentity } from "@/lib/require-identity";

export default async function DocumentsPage() {
  const identity = await requireIdentity("/documents");
  return <AppShell role={identity.role} userName={identity.name}><DocumentRegister /></AppShell>;
}
