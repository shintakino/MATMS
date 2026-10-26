"use client";

import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { Label } from "@matms/ui/components/label";
import { useMutation } from "@tanstack/react-query";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { orpc } from "@/utils/orpc";

export function ChangePasswordForm({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const changePassword = useMutation(orpc.identity.changeOwnPassword.mutationOptions());

  async function submit(formData: FormData) {
    const currentPassword = String(formData.get("currentPassword") ?? "");
    const newPassword = String(formData.get("newPassword") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }

    setError(null);
    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      router.replace(returnTo as Route);
      router.refresh();
    } catch {
      setError("We could not update your password. Check your current password and try again.");
    }
  }

  return (
    <form action={submit} className="space-y-5" noValidate>
      <div className="space-y-2">
        <Label htmlFor="current-password">Current password</Label>
        <Input autoComplete="current-password" id="current-password" name="currentPassword" required type="password" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-password">New password</Label>
        <Input autoComplete="new-password" id="new-password" minLength={12} name="newPassword" required type="password" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <Input autoComplete="new-password" id="confirm-password" minLength={12} name="confirmPassword" required type="password" />
      </div>
      {error ? <p aria-live="polite" className="text-sm text-destructive" role="alert">{error}</p> : null}
      <Button className="w-full" disabled={changePassword.isPending} type="submit">
        {changePassword.isPending ? "Updating password…" : "Update password"}
      </Button>
    </form>
  );
}
