import { AppShell } from "@/components/app-shell";
import { ArchiveDetail } from "@/components/archive-register";
import { requireIdentity } from "@/lib/require-identity";
import { LifecycleControl } from "@/components/lifecycle-control";
import { ArchiveMaintenance } from "@/components/archive-maintenance";

export default async function FolderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await requireIdentity(`/folders/${id}`);
  return <AppShell role={identity.role} userName={identity.name}><ArchiveDetail id={id} kind="folder" />{identity.role !== "viewer" ? <ArchiveMaintenance id={id} kind="folder" role={identity.role} /> : null}{identity.role === "admin" ? <LifecycleControl id={id} kind="folder" /> : null}</AppShell>;
}
