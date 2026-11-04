import type { Route } from "next";
import { ORPCError } from "@orpc/client";
import { redirect } from "next/navigation";

import { client } from "@/utils/orpc";

export async function requireIdentity(returnTo: string) {
  let identity: Awaited<ReturnType<typeof client.identity.me>>;
  try {
    identity = await client.identity.me();
  } catch (error) {
    if (error instanceof ORPCError && error.code === "UNAUTHORIZED") redirect(`/login?returnTo=${encodeURIComponent(returnTo)}` as Route);
    throw error;
  }

  if (identity.mustChangePassword) {
    redirect(`/change-password?returnTo=${encodeURIComponent(returnTo)}` as Route);
  }

  return identity;
}
