"use client";

import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { Label } from "@matms/ui/components/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@matms/ui/components/alert-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@matms/ui/components/dialog";
import { orpc } from "@/utils/orpc";

type Role = "admin" | "property_custodian" | "staff" | "viewer";

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
  const [resetAccount, setResetAccount] = useState<{ id: string; name: string; email: string } | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ kind: "role"; userId: string; name: string; role: Role } | { kind: "active"; userId: string; name: string; active: boolean } | null>(null);

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

  async function assistedReset(data: FormData) {
    if (!resetAccount) return;
    const password = String(data.get("password") ?? "");
    if (password !== String(data.get("confirmPassword") ?? "")) { setResetError("The passwords do not match."); return; }
    setResetError(null);
    try {
      await resetPassword.mutateAsync({ userId: resetAccount.id, password });
      await refresh("Password reset. The user must change it on their next sign-in.");
      setResetAccount(null);
    } catch (error) { setResetError(errorMessage(error)); }
  }

  return (
    <section className="mx-auto w-full max-w-6xl space-y-8 p-6 sm:p-10">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold">User accounts</h1>
        <p className="text-sm text-muted-foreground">Provision accounts, control access, and perform assisted password resets.</p>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Provision account</h2><p className="mt-2 text-sm text-muted-foreground">Administrator manages accounts and all school records. Property Custodian manages property stock and counts. Staff handles permitted filing and custody; property counts require assignment. Viewer has read-only access.</p>
        <form action={createAccount} className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" name="name" required /></div>
          <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" name="email" required type="email" /></div>
          <div className="space-y-2"><Label htmlFor="password">Temporary password</Label><Input id="password" minLength={12} name="password" required type="password" /></div>
          <div className="space-y-2"><Label htmlFor="role">Role</Label><select className="h-8 w-full rounded-none border border-input bg-transparent px-2.5 text-xs" defaultValue="viewer" id="role" name="role"><option value="admin">Administrator</option><option value="property_custodian">Property Custodian</option><option value="staff">Staff</option><option value="viewer">Viewer</option></select></div>
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
                <td className="p-3"><select aria-label={`Role for ${account.name}`} className="h-8 rounded-none border border-input bg-transparent px-2 text-xs" disabled={changeRole.isPending} onChange={(event) => setConfirmation({ kind: "role", userId: account.id, name: account.name, role: event.target.value as Role })} value={account.role}><option value="admin">Administrator</option><option value="property_custodian">Property Custodian</option><option value="staff">Staff</option><option value="viewer">Viewer</option></select></td>
                <td className="p-3">{account.active ? "Active" : "Inactive"}</td>
                <td className="p-3">{account.mustChangePassword ? "Change required" : "Current"}</td>
                <td className="p-3"><div className="flex flex-wrap gap-2"><Button disabled={setActive.isPending} onClick={() => setConfirmation({ kind: "active", userId: account.id, name: account.name, active: !account.active })} size="sm" type="button" variant="outline">{account.active ? "Deactivate" : "Activate"}</Button><Button disabled={resetPassword.isPending} onClick={() => { setResetError(null); setResetAccount({ id: account.id, name: account.name, email: account.email }); }} size="sm" type="button" variant="outline">Reset password</Button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <Dialog open={resetAccount !== null} onOpenChange={(open) => { if (!open && !resetPassword.isPending) setResetAccount(null); }}><DialogContent><DialogHeader><DialogTitle>Reset password for {resetAccount?.name}?</DialogTitle><DialogDescription>{resetAccount?.email}. This revokes existing sessions. The user must change the temporary password at their next sign-in.</DialogDescription></DialogHeader><form key={resetAccount?.id} className="space-y-4" onSubmit={(event) => { event.preventDefault(); void assistedReset(new FormData(event.currentTarget)); }}><label>New temporary password<Input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label><label>Confirm temporary password<Input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>{resetError ? <p role="alert" className="text-sm text-destructive">{resetError}</p> : null}<DialogFooter><Button type="button" variant="outline" disabled={resetPassword.isPending} onClick={() => setResetAccount(null)}>Cancel</Button><Button type="submit" disabled={resetPassword.isPending}>{resetPassword.isPending ? "Resetting…" : "Confirm password reset"}</Button></DialogFooter></form></DialogContent></Dialog>
      <AlertDialog open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirmation?.kind === "role" ? `Change ${confirmation.name}'s role?` : `${confirmation?.active ? "Activate" : "Deactivate"} ${confirmation?.name}?`}</AlertDialogTitle><AlertDialogDescription>{confirmation?.kind === "role" ? `Changing the role to ${confirmation.role} changes the account's permitted actions.` : confirmation?.active ? "The account will be able to sign in again." : "The account will lose access and its active sessions will be revoked. Historical attribution is preserved."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { if (confirmation?.kind === "role") void updateRole(confirmation.userId, confirmation.role); else if (confirmation?.kind === "active") void updateActive(confirmation.userId, confirmation.active); setConfirmation(null); }}>Confirm</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </section>
  );
}
