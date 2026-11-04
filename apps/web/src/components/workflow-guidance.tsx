"use client";

import { CheckIcon, ArrowRightIcon } from "lucide-react";
import { Button } from "@matms/ui/components/button";

type WorkflowStep = { label: string; description: string; complete: boolean; target?: string };

/** Opens a workflow section without clearing its form inputs. */
export function openWorkflowSection(id: string) {
  const section = document.getElementById(id);
  if (!section) return;
  if (section instanceof HTMLDetailsElement) section.open = true;
  section.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
  const target = section instanceof HTMLDetailsElement ? section.querySelector("summary") : section;
  if (target instanceof HTMLElement) {
    if (!(section instanceof HTMLDetailsElement)) target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }
}

export function WorkflowGuidance({ title, steps, next, target }: { title: string; steps: WorkflowStep[]; next: string; target?: string }) {
  const current = steps.findIndex((step) => !step.complete);
  return <section className="rounded-xl border bg-card p-5" aria-label={title}>
    <h2 className="font-semibold">{title}</h2>
    <ol className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {steps.map((step, index) => <li key={step.label} aria-current={index === current ? "step" : undefined} className="flex gap-3 rounded-lg bg-muted/50 p-3">
        <span aria-hidden="true" className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${step.complete || index === current ? "bg-primary text-primary-foreground" : "border bg-card text-muted-foreground"}`}>{step.complete ? <CheckIcon className="size-4" /> : index + 1}</span>
        <div><p className="text-sm font-medium">{step.target ? <button type="button" className="text-left underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => openWorkflowSection(step.target!)}>{step.label}</button> : step.label}<span className="sr-only">{step.complete ? " — completed" : index === current ? " — current step" : " — remaining"}</span></p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.description}</p></div>
      </li>)}
    </ol>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="max-w-3xl text-sm leading-relaxed">{next}</p>{target ? <Button type="button" variant="outline" onClick={() => openWorkflowSection(target)}>Go to next step<ArrowRightIcon aria-hidden="true" /></Button> : null}</div>
  </section>;
}

export function InventoryTerms() {
  return <details className="rounded-lg border bg-card p-4"><summary className="cursor-pointer text-sm font-medium">Help with inventory terms</summary><dl className="mt-3 grid gap-4 text-sm sm:grid-cols-2">{[
    ["Item", "The kind of supply or property, such as copy paper or a desktop computer."],
    ["Acquisition lot", "A group or individual property record with its own acquisition details, value and property number. Ordinary supplies can use a Stock Card balance without a lot."],
    ["Office balance", "How many units are recorded for one item or lot, fund and office. Creating it starts at zero."],
    ["Fund cluster", "The funding category recorded on the official form. Use the name or code confirmed by your accounting office."],
    ["Form profile", "The school-reviewed version of a report layout, including columns and signature positions."],
    ["Variance", "Physical count minus the recorded card balance. A negative difference is a shortage; a positive difference is an overage."],
  ].map(([term, meaning]) => <div key={term}><dt className="font-medium">{term}</dt><dd className="mt-1 leading-relaxed text-muted-foreground">{meaning}</dd></div>)}</dl></details>;
}
