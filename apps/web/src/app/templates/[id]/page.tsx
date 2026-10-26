import { AppShell } from "@/components/app-shell";
import { TemplateDetail } from "@/components/inventory-register";
import { requireIdentity } from "@/lib/require-identity";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await requireIdentity(`/templates/${id}`);
  return <AppShell role={identity.role} userName={identity.name}><TemplateDetail id={id} /></AppShell>;
}
