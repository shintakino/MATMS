import { AppShell } from "@/components/app-shell";
import { SettingsWorkspace } from "@/components/settings-workspace";
import { canonicalOrigin } from "@/lib/qr-url";
import { requireIdentity } from "@/lib/require-identity";

export default async function SettingsPage() {
  const identity = await requireIdentity("/admin/settings");
  return <AppShell role={identity.role} userName={identity.name}>{identity.role === "admin" ? <SettingsWorkspace fallbackOrigin={canonicalOrigin(process.env.MATMS_CANONICAL_ORIGIN)} /> : <section className="p-6">This content is unavailable.</section>}</AppShell>;
}
