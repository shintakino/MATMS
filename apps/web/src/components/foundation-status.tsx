"use client";

import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/utils/orpc";

export default function FoundationStatus() {
  const healthCheck = useQuery(orpc.healthCheck.queryOptions());
  const label = healthCheck.isLoading
    ? "Checking the Hono API…"
    : healthCheck.data
      ? "Hono API connected"
      : "Hono API unavailable";

  return (
    <p aria-live="polite" className="text-sm text-muted-foreground">
      {label}
    </p>
  );
}
