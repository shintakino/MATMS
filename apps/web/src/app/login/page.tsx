import { ArchiveIcon, ArrowRightIcon, BoxIcon, ClipboardCheckIcon, FileTextIcon } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import { safeReturnPath } from "@/lib/return-path";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;

  return (
    <main className="auth-screen grid min-h-svh lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex xl:p-16">
        <div className="flex items-center gap-3"><ArchiveIcon aria-hidden="true" className="size-8" /><span className="text-xl font-bold tracking-tight">MATMS</span></div>
        <div className="max-w-lg py-16"><p className="mb-5 text-xs font-medium uppercase tracking-[0.2em] text-primary-foreground/80">A more organized school day</p><h2 className="text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">Every record.<br />Every resource.<br />One workspace.</h2><p className="mt-6 text-base leading-relaxed text-primary-foreground/85">Find what you need, track what matters, and keep your school’s records and inventory in order.</p><div className="mt-10 space-y-4 text-sm">{[{ icon: FileTextIcon, label: "Archives & documents" }, { icon: BoxIcon, label: "Property & supplies" }, { icon: ClipboardCheckIcon, label: "Requests & accountability" }].map(({ icon: FeatureIcon, label }) => <div className="flex items-center gap-3" key={label}><FeatureIcon aria-hidden="true" className="size-4" /><span>{label}</span></div>)}</div></div>
        <p className="text-xs text-primary-foreground/75">Meocan Archive & Template Management System</p>
      </aside>
      <section className="flex items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm space-y-7">
          <span className="flex size-12 items-center justify-center rounded-xl bg-accent text-primary"><ArchiveIcon aria-hidden="true" className="size-6" /></span>
          <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">Welcome to MATMS</p><h1 className="text-3xl font-semibold tracking-tight">Sign in to your workspace</h1><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Use the account provided by your Administrator.</p></div>
          <LoginForm returnTo={safeReturnPath(returnTo)} />
          <div className="flex gap-3 border-t pt-5 text-xs leading-relaxed text-muted-foreground"><ArrowRightIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><p>Need help accessing your account? Contact an Administrator for an assisted password reset.</p></div>
        </div>
      </section>
    </main>
  );
}
