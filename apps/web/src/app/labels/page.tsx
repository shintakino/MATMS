import { AppShell } from "@/components/app-shell";
import { LabelsWorkspace } from "@/components/qr-workspace";
import { canonicalOrigin } from "@/lib/qr-url";
import { requireIdentity } from "@/lib/require-identity";
import { client } from "@/utils/orpc";

export default async function LabelsPage() {
  const identity = await requireIdentity("/labels");
  const settings = await client.admin.settings.get();
  return <AppShell role={identity.role} userName={identity.name}><LabelsWorkspace origin={canonicalOrigin(("id" in settings ? settings.canonicalOrigin : process.env.MATMS_CANONICAL_ORIGIN) ?? undefined)} /></AppShell>;
}
