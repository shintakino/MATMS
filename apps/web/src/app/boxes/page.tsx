import { AppShell } from "@/components/app-shell";
import { BoxRegister } from "@/components/archive-register";
import { requireIdentity } from "@/lib/require-identity";

export default async function BoxesPage() {
  const identity = await requireIdentity("/boxes");
  return <AppShell role={identity.role} userName={identity.name}><BoxRegister role={identity.role} /></AppShell>;
}
