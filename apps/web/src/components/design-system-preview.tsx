"use client";

import { AppShell } from "@/components/app-shell";
import { StockStatusBadge } from "@/components/stock-status-badge";
import { EmptyState, ErrorState, LoadingState, PendingSubmitButton, UnavailableState } from "@/components/ui-states";
import { Alert, AlertDescription, AlertTitle } from "@matms/ui/components/alert";
import { Badge } from "@matms/ui/components/badge";
import { Button } from "@matms/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@matms/ui/components/card";
import { Checkbox } from "@matms/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@matms/ui/components/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@matms/ui/components/dropdown-menu";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@matms/ui/components/field";
import { Input } from "@matms/ui/components/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@matms/ui/components/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@matms/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@matms/ui/components/table";
import { AlertCircleIcon, EllipsisIcon, InfoIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

const stockFixtures = [
  { label: "Printer paper", quantity: 0, threshold: 5 },
  { label: "Archive folders", quantity: 5, threshold: 5 },
  { label: "Document sleeves", quantity: 9, threshold: 5 },
];

const tableFixtures = [
  { id: "1", title: "Archive folders", location: "Supply cabinet", quantity: 5, threshold: 5 },
  { id: "2", title: "Printer paper", location: "Supply cabinet", quantity: 0, threshold: 5 },
  { id: "3", title: "Document sleeves", location: "Records room", quantity: 9, threshold: 5 },
];

export function DesignSystemPreview() {
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const allSelected = selected.length === tableFixtures.length;
  const toggleAll = (checked: boolean) => setSelected(checked ? tableFixtures.map((row) => row.id) : []);
  const toggleRow = (id: string, checked: boolean) =>
    setSelected((current) => (checked ? [...current, id] : current.filter((currentId) => currentId !== id)));

  return (
    <AppShell role="admin">
      <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
        <section className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Design-system foundation</p>
            <h1 className="text-2xl font-semibold tracking-tight">Administrative workspace preview</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Shared shell, accessible primitives, and fictitious fixtures for MATMS feature work.
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger render={<Button />}>
              Add preview record
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Preview form</DialogTitle>
                <DialogDescription>
                  This demonstrates error association and focus handling only. It does not submit data.
                </DialogDescription>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  setPreviewError("Preview forms do not create records. Your entered values remain available to edit.");
                }}
              >
                <FieldGroup>
                  <Field data-invalid={Boolean(previewError)}>
                    <FieldLabel htmlFor="preview-name">Record name</FieldLabel>
                    <Input
                      aria-describedby={previewError ? "preview-name-error" : undefined}
                      aria-invalid={Boolean(previewError)}
                      id="preview-name"
                      name="name"
                      placeholder="e.g. Mathematics folders"
                      required
                    />
                    <FieldDescription>Use a clear, searchable title.</FieldDescription>
                    {previewError ? <FieldError id="preview-name-error">{previewError}</FieldError> : null}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="preview-location">Location</FieldLabel>
                    <Select name="location">
                      <SelectTrigger id="preview-location" className="w-full">
                        <SelectValue placeholder="Choose a location" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="records-room">Records room</SelectItem>
                        <SelectItem value="supply-cabinet">Supply cabinet</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </FieldGroup>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <PendingSubmitButton pending={false} type="submit">
                    Save preview
                  </PendingSubmitButton>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </section>

        <Alert>
          <InfoIcon aria-hidden="true" />
          <AlertTitle>Fictional data only</AlertTitle>
          <AlertDescription>
            The role, stock figures, and rows on this page are presentation fixtures. They do not grant access or represent stored balances.
          </AlertDescription>
        </Alert>

        <section className="grid gap-4 md:grid-cols-3" aria-label="Stock status fixtures">
          {stockFixtures.map((fixture) => (
            <Card key={fixture.label}>
              <CardHeader>
                <CardTitle>{fixture.label}</CardTitle>
                <CardDescription>
                  {fixture.quantity} on hand · reorder at {fixture.threshold}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <StockStatusBadge quantity={fixture.quantity} reorderThreshold={fixture.threshold} />
              </CardContent>
            </Card>
          ))}
        </section>

        <section aria-labelledby="list-pattern-heading" className="space-y-3">
          <div className="space-y-1">
            <h2 id="list-pattern-heading" className="text-lg font-semibold">Server-list composition</h2>
            <p className="text-sm text-muted-foreground">
              Controls publish query state; the shown fixture is deliberately not client-filtered. Feature consumers replace it with authorized server results and counts.
            </p>
          </div>
          <Card>
            <CardContent className="space-y-4 pt-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
                <div className="relative">
                  <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
                  <Input
                    aria-label="Search inventory fixture"
                    className="pl-8"
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setPage(1);
                    }}
                    placeholder="Search inventory"
                    value={search}
                  />
                </div>
                <Select value={sort} onValueChange={(value) => setSort(value ?? "name")}>
                  <SelectTrigger aria-label="Sort inventory fixture" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name">Sort: name</SelectItem>
                    <SelectItem value="quantity">Sort: quantity</SelectItem>
                  </SelectContent>
                </Select>
                <Badge className="h-8 bg-info text-info-foreground">Server query: page {page}</Badge>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label="Select all fixture rows"
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                      />
                    </TableHead>
                    <TableHead>Supply</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead><span className="sr-only">Row actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableFixtures.map((row) => (
                    <TableRow data-state={selected.includes(row.id) ? "selected" : undefined} key={row.id}>
                      <TableCell>
                        <Checkbox
                          aria-label={`Select ${row.title}`}
                          checked={selected.includes(row.id)}
                          onCheckedChange={(checked) => toggleRow(row.id, checked)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{row.title}</TableCell>
                      <TableCell>{row.location}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div className="flex justify-end gap-2">
                          <span>{row.quantity}</span>
                          <StockStatusBadge quantity={row.quantity} reorderThreshold={row.threshold} />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button aria-label={`Actions for ${row.title}`} size="icon-sm" variant="ghost" />}>
                            <EllipsisIcon aria-hidden="true" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem disabled>View when records are available</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">3 fictional results · authorized totals will come from the server</p>
                <Pagination className="mx-0 w-auto sm:ml-auto">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#list-pattern-heading"
                        onClick={(event) => {
                          event.preventDefault();
                          setPage((current) => Math.max(1, current - 1));
                        }}
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationLink href="#list-pattern-heading" isActive>{page}</PaginationLink>
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext
                        href="#list-pattern-heading"
                        onClick={(event) => {
                          event.preventDefault();
                          setPage((current) => current + 1);
                        }}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-2" aria-label="Shared UI states">
          <Card>
            <CardHeader>
              <CardTitle>Reusable states</CardTitle>
              <CardDescription>Feature screens receive accessible loading, empty, error, and unavailable patterns.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <LoadingState label="Loading preview fixtures" />
              <EmptyState title="No boxes match this view" description="Change a server-side filter or create a box when that workflow is available." />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Problem feedback</CardTitle>
              <CardDescription>Persistent alerts describe unresolved issues; transient updates use the shared toast provider.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ErrorState description="The preview could not refresh. Retry will be connected to a server query in a consuming feature." />
              <UnavailableState />
              <div className="flex items-center gap-2">
                <AlertCircleIcon aria-hidden="true" className="size-4 text-warning" />
                <p className="text-xs text-muted-foreground">Pending mutations never show a changed balance before the server confirms it.</p>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>
    </AppShell>
  );
}
