import { ChangePasswordForm } from "@/components/change-password-form";
import { safeReturnPath } from "@/lib/return-path";

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;

  return (
    <main className="mx-auto flex min-h-svh max-w-xl items-center px-6 py-16">
      <section className="w-full space-y-5 rounded-lg border border-border bg-card p-8 text-card-foreground shadow-sm">
        <h1 className="text-2xl font-semibold">Set a new password</h1>
        <p className="text-muted-foreground">A password change is required before you can use MATMS.</p>
        <ChangePasswordForm returnTo={safeReturnPath(returnTo)} />
      </section>
    </main>
  );
}
