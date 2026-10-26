"use client";

import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { Label } from "@matms/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "@/utils/orpc";

type Role = "admin" | "staff" | "viewer";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The account change could not be completed.";
}

export function AdminUserManagement() {
  const queryClient = useQueryClient();
  const users = useQuery(orpc.identity.admin.listUsers.queryOptions());
  const provision = useMutation(orpc.identity.admin.provisionUser.mutationOptions());
  const changeRole = useMutation(orpc.identity.admin.changeRole.mutationOptions());
  const setActive = useMutation(orpc.identity.admin.setActive.mutationOptions());
  const resetPassword = useMutation(orpc.identity.admin.resetPassword.mutationOptions());
  const [message, setMessage] = useState<string | null>(null);

  async function refresh(message: string) {
    await queryClient.invalidateQueries({ queryKey: orpc.identity.admin.listUsers.queryKey() });
    setMessage(message);
  }

  async function createAccount(formData: FormData) {
    setMessage(null);
    try {
      await provision.mutateAsync({
        name: String(formData.get("name") ?? ""),
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        role: String(formData.get("role") ?? "viewer") as Role,
      });
      await refresh("Account provisioned. The user must set a new password after their first sign-in.");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function updateRole(userId: string, role: Role) {
    setMessage(null);
    try {
      await changeRole.mutateAsync({ userId, role });
      await refresh("Account role updated.");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function updateActive(userId: string, active: boolean) {
    setMessage(null);
    try {
      await setActive.mutateAsync({ userId, active });
      await refresh(active ? "Account activated." : "Account deactivated and active sessions revoked.");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function assistedReset(userId: string) {
    const password = window.prompt("Enter a temporary password (at least 12 characters).");
    if (!password) {
      return;
    }
    setMessage(null);
    try {
      await resetPassword.mutateAsync({ userId, password });
      await refresh("Password reset. The user must change it on their next sign-in.");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 p-6 sm:p-10">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold">User accounts</h1>
        <p className="text-sm text-muted-foreground">Provision accounts, control access, and perform assisted password resets.</p>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Provision account</h2>
        <form action={createAccount} className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" name="name" required /></div>
          <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" name="email" required type="email" /></div>
          <div className="space-y-2"><Label htmlFor="password">Temporary password</Label><Input id="password" minLength={12} name="password" required type="password" /></div>
          <div className="space-y-2"><Label htmlFor="role">Role</Label><select className="h-8 w-full rounded-none border border-input bg-transparent px-2.5 text-xs" defaultValue="viewer" id="role" name="role"><option value="admin">Administrator</option><option value="staff">Staff</option><option value="viewer">Viewer</option></select></div>
          <div className="md:col-span-2"><Button disabled={provision.isPending} type="submit">{provision.isPending ? "Provisioning…" : "Provision account"}</Button></div>
        </form>
      </section>

      {message ? <p aria-live="polite" className="text-sm text-muted-foreground" role="status">{message}</p> : null}

      <section className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <caption className="sr-only">MATMS user accounts</caption>
          <thead className="border-b border-border text-xs text-muted-foreground"><tr><th className="p-3">User</th><th className="p-3">Role</th><th className="p-3">Status</th><th className="p-3">Password</th><th className="p-3">Actions</th></tr></thead>
          <tbody>
            {users.isLoading ? <tr><td className="p-3" colSpan={5}>Loading accounts…</td></tr> : null}
            {users.isError ? <tr><td className="p-3 text-destructive" colSpan={5}>Accounts are unavailable.</td></tr> : null}
            {users.data?.map((account) => (
              <tr className="border-b border-border last:border-0" key={account.id}>
                <td className="p-3"><p className="font-medium">{account.name}</p><p className="text-xs text-muted-foreground">{account.email}</p></td>
                <td className="p-3"><select aria-label={`Role for ${account.name}`} className="h-8 rounded-none border border-input bg-transparent px-2 text-xs" disabled={changeRole.isPending} onChange={(event) => void updateRole(account.id, event.target.value as Role)} value={account.role}><option value="admin">Administrator</option><option value="staff">Staff</option><option value="viewer">Viewer</option></select></td>
                <td className="p-3">{account.active ? "Active" : "Inactive"}</td>
                <td className="p-3">{account.mustChangePassword ? "Change required" : "Current"}</td>
                <td className="p-3"><div className="flex flex-wrap gap-2"><Button disabled={setActive.isPending} onClick={() => void updateActive(account.id, !account.active)} size="sm" type="button" variant="outline">{account.active ? "Deactivate" : "Activate"}</Button><Button disabled={resetPassword.isPending} onClick={() => void assistedReset(account.id)} size="sm" type="button" variant="outline">Reset password</Button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
