"use client";

import { useId, useState } from "react";
import { Input } from "@matms/ui/components/input";

type Choice = { id: string; label: string };
/** Search over a complete, authorized choice list, preserving the selected option. */
export function SearchableChoice({ label, name, options, required, disabled, value, onChange, empty = "No choices available.", defaultValue = "" }: {
  label: string; name?: string; options: Choice[]; required?: boolean; disabled?: boolean;
  value?: string; onChange?: (id: string) => void; empty?: string; defaultValue?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [localValue, setLocalValue] = useState(defaultValue);
  const selected = value ?? localValue;
  const needle = query.trim().toLocaleLowerCase();
  const visible = options.filter((option) => option.id === selected || option.label.toLocaleLowerCase().includes(needle));
  return <div className="space-y-2"><label htmlFor={`${id}-search`} className="text-xs text-muted-foreground">Search {label.toLowerCase()}</label><Input id={`${id}-search`} type="search" value={query} disabled={disabled} onChange={(event) => setQuery(event.target.value)} placeholder="Type a name or code" /><label htmlFor={id}>{label}</label><select id={id} name={name} value={selected} required={required} disabled={disabled} className="block h-10 w-full rounded-md border bg-card px-2 text-sm" onChange={(event) => { setLocalValue(event.target.value); onChange?.(event.target.value); }}><option value="">Select {label.toLowerCase()}</option>{selected && !options.some((option) => option.id === selected) ? <option value={selected} disabled>Selection unavailable — choose again</option> : null}{visible.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>{!options.length ? <p className="text-xs text-muted-foreground">{empty}</p> : !visible.length ? <p className="text-xs text-muted-foreground">No matching choices. Change the search.</p> : null}</div>;
}
