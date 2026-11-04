import { AppShell } from "@/components/app-shell";
import { ScanWorkspace } from "@/components/qr-workspace";
import { canonicalOrigin } from "@/lib/qr-url";
import { requireIdentity } from "@/lib/require-identity";
import { client } from "@/utils/orpc";

export default async function ScanPage() {
  const identity = await requireIdentity("/scan");
  const settings = await client.admin.settings.get();
  return <AppShell role={identity.role} userName={identity.name}><ScanWorkspace origin={canonicalOrigin(("id" in settings ? settings.canonicalOrigin : process.env.MATMS_CANONICAL_ORIGIN) ?? undefined)} /></AppShell>;
}
