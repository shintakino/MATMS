import { AppShell } from "@/components/app-shell";
import { TemplateRegister } from "@/components/inventory-register";
import { requireIdentity } from "@/lib/require-identity";

export default async function TemplatesPage() { const identity = await requireIdentity("/templates"); return <AppShell role={identity.role} userName={identity.name}><TemplateRegister role={identity.role} /><div className="mx-auto max-w-7xl px-6 pb-8"><a className="text-primary underline" href="/inventory">View and manage template stock</a></div></AppShell>; }
