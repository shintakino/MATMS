import { LoginForm } from "@/components/login-form";
import { safeReturnPath } from "@/lib/return-path";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;

  return (
    <main className="mx-auto flex min-h-svh max-w-xl items-center px-6 py-16">
      <section className="w-full space-y-5 rounded-lg border border-border bg-card p-8 text-card-foreground shadow-sm">
        <h1 className="text-2xl font-semibold">MATMS access</h1>
        <p className="text-muted-foreground">
          Sign in with the account provided by your Administrator.
        </p>
        <LoginForm returnTo={safeReturnPath(returnTo)} />
        <p className="text-sm text-muted-foreground">
          Need help accessing your account? Contact an Administrator for an assisted password reset.
        </p>
      </section>
    </main>
  );
}
