import { AppShell } from "@/components/app-shell";
import { client } from "@/utils/orpc";
import type { Route } from "next";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  let identity: Awaited<ReturnType<typeof client.identity.me>>;

  try {
    identity = await client.identity.me();
  } catch {
    redirect("/login?returnTo=%2Fdashboard" as Route);
  }

  if (identity.mustChangePassword) {
    redirect("/change-password?returnTo=%2Fdashboard" as Route);
  }

  return (
    <AppShell role={identity.role} userName={identity.name}>
      <main className="flex flex-1 items-center justify-center p-6 sm:p-10">
        <section className="w-full max-w-2xl space-y-3 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
          <h1 className="text-xl font-semibold">Welcome, {identity.name}</h1>
          <p className="text-sm text-muted-foreground">
            Your authenticated workspace is ready. Archive operations are introduced in the next feature.
          </p>
        </section>
      </main>
    </AppShell>
  );
}
