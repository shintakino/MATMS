import { AppShell } from "@/components/app-shell";
import { ArchiveDetail } from "@/components/archive-register";
import { requireIdentity } from "@/lib/require-identity";
import { LifecycleControl } from "@/components/lifecycle-control";
import { BoxActions, FolderIntake } from "@/components/archive-intake";

export default async function BoxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await requireIdentity(`/boxes/${id}`);
  return <AppShell role={identity.role} userName={identity.name}><ArchiveDetail id={id} kind="box" />{identity.role !== "viewer" ? <BoxActions boxId={id} role={identity.role} /> : null}{identity.role === "admin" ? <><FolderIntake boxId={id} /><LifecycleControl id={id} kind="box" /></> : null}</AppShell>;
}
