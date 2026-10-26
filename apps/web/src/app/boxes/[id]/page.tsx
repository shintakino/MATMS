import { AppShell } from "@/components/app-shell";
import { ArchiveDetail } from "@/components/archive-register";
import { requireIdentity } from "@/lib/require-identity";

export default async function BoxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await requireIdentity(`/boxes/${id}`);
  return <AppShell role={identity.role} userName={identity.name}><ArchiveDetail id={id} kind="box" /></AppShell>;
}
