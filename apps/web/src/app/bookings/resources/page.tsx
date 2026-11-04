import { AppShell } from "@/components/app-shell";
import { ResourceManager } from "@/components/scheduling-admin";
import { requireIdentity } from "@/lib/require-identity";
import { redirect } from "next/navigation";

export default async function Page() {
  const identity = await requireIdentity("/bookings/resources");
  if (identity.role !== "admin") redirect("/dashboard");
  return <AppShell role={identity.role} userName={identity.name}><ResourceManager /></AppShell>;
}
