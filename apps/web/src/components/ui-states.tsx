import { Alert, AlertDescription, AlertTitle } from "@matms/ui/components/alert";
import { Button } from "@matms/ui/components/button";
import { Skeleton } from "@matms/ui/components/skeleton";
import { AlertCircleIcon, InboxIcon, LockKeyholeIcon } from "lucide-react";
import type * as React from "react";

export function LoadingState({ label = "Loading content" }: { label?: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="space-y-3">
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
    <div className="flex min-h-48 flex-col items-center justify-center border border-dashed border-border p-6 text-center">
      <InboxIcon aria-hidden="true" className="mb-3 size-5 text-muted-foreground" />
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-1 max-w-md text-xs/relaxed text-muted-foreground">{description}</p>
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
        <Button className="mt-2 w-fit" size="sm" variant="outline" onClick={onRetry}>
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
