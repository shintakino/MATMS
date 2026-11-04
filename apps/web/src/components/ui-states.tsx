import { Alert, AlertDescription, AlertTitle } from "@matms/ui/components/alert";
import { Button } from "@matms/ui/components/button";
import { Skeleton } from "@matms/ui/components/skeleton";
import { AlertCircleIcon, InboxIcon, LockKeyholeIcon } from "lucide-react";
import type * as React from "react";

export function LoadingState({ label = "Loading content" }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="space-y-3">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-8 text-center">
      <InboxIcon aria-hidden="true" className="mb-4 size-10 rounded-xl bg-accent p-2.5 text-primary" />
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-2 max-w-md text-sm/relaxed text-muted-foreground">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "We could not load this content",
  description,
  onRetry,
}: {
  title?: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertCircleIcon aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      {onRetry ? (
        <Button className="mt-2 w-fit text-foreground" size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </Alert>
  );
}

export function UnavailableState({ description }: { description?: string }) {
  return (
    <Alert>
      <LockKeyholeIcon aria-hidden="true" />
      <AlertTitle>This content is unavailable</AlertTitle>
      <AlertDescription>
        {description ?? "You may not have access, or this item may no longer be available."}
      </AlertDescription>
    </Alert>
  );
}

export function PendingSubmitButton({
  pending,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { pending: boolean }) {
  return (
    <Button {...props} aria-busy={pending} disabled={pending || props.disabled}>
      {pending ? "Saving…" : children}
    </Button>
  );
}
