"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { QRCodeSVG } from "qrcode.react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { scannedBoxPath } from "@/lib/qr-url";
import { client, orpc } from "@/utils/orpc";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui-states";
import "./qr-workspace.css";

export function LabelsWorkspace({ origin }: { origin: string | null }) {
  const boxes = useQuery(orpc.archive.boxes.labels.queryOptions());
  const [selected, setSelected] = useState<string[]>([]);
  const [layout, setLayout] = useState<"a4" | "single">("a4");
  const [width, setWidth] = useState(90);
  const [height, setHeight] = useState(48);
  const [printedAt, setPrintedAt] = useState("");
  const visible = boxes.data?.filter((box) => selected.includes(box.id)) ?? [];
  function toggle(id: string) { setSelected((previous) => previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]); }
  function print() {
    setPrintedAt(new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium" }).format(new Date()));
    // Wait for React to commit the date before opening the print dialog.
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }
  return <section className="mx-auto w-full max-w-6xl space-y-5 p-6 sm:p-10">
    <div><h1 className="text-2xl font-semibold">Box labels</h1><p className="text-sm text-muted-foreground">Select permitted boxes, choose a layout, and calibrate the label dimensions for your printer.</p></div>
    {!origin ? <p role="alert">Labels are unavailable until an administrator configures a canonical HTTPS origin.</p> : null}
    {boxes.isLoading ? <LoadingState label="Loading boxes" /> : null}
    {boxes.isError ? <ErrorState description="Label data is unavailable." onRetry={() => void boxes.refetch()} /> : null}
    {boxes.data?.length === 0 ? <EmptyState title="No boxes available" description="There are no permitted boxes to label." /> : null}
    {boxes.data?.length ? <section className="space-y-3"><h2 className="font-semibold">Select boxes</h2><div className="max-h-64 space-y-2 overflow-auto rounded-md border p-3">{boxes.data.map((box) => <label key={box.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(box.id)} onChange={() => toggle(box.id)} /><span>{box.code} — {box.categoryName} — {box.locationLabel}</span></label>)}</div></section> : null}
    <section className="flex flex-wrap items-end gap-4"><label className="text-sm">Layout<select className="block h-9 border bg-background px-2" value={layout} onChange={(e) => setLayout(e.target.value as "a4" | "single")}><option value="a4">A4 sheet</option><option value="single">Single label per page</option></select></label><label className="text-sm">Label width (mm)<Input type="number" min={40} max={190} value={width} onChange={(e) => setWidth(Number(e.target.value))} /></label><label className="text-sm">Label height (mm)<Input type="number" min={30} max={150} value={height} onChange={(e) => setHeight(Number(e.target.value))} /></label><Button disabled={!origin || !visible.length || boxes.isFetching || boxes.isError || width < 40 || width > 190 || height < 30 || height > 150} onClick={print}>Print labels</Button></section>
    <p className="text-sm text-muted-foreground">Print at actual size. Confirm calibration and readability on the target printer before applying labels.</p>
    {origin && visible.length ? <section className={`qr-print-sheet ${layout === "single" ? "qr-single" : "qr-a4"}`} aria-label="Label preview" style={{ "--label-width": `${Math.min(190, Math.max(40, width || 40))}mm`, "--label-height": `${Math.min(150, Math.max(30, height || 30))}mm` } as React.CSSProperties}>{visible.map((box) => <article className="qr-label" key={box.id}><QRCodeSVG value={`${origin}/boxes/${box.id}`} size={120} level="M" marginSize={4} title={`QR code for ${box.code}`} /><div><strong>{box.code}</strong><p>{box.categoryName}</p><p>{box.locationLabel}</p><p>Printed: {printedAt || "on print"}</p></div></article>)}</section> : null}
  </section>;
}

export function ScanWorkspace({ origin }: { origin: string | null }) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<{ stop(): void } | null>(null);
  const generation = useRef(0);
  const [camera, setCamera] = useState(false);
  const [message, setMessage] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  function stop() { generation.current++; controls.current?.stop(); controls.current = null; setCamera(false); }
  useEffect(() => () => { generation.current++; controls.current?.stop(); }, []);
  async function start() {
    stop(); setMessage("");
    if (!origin) { setMessage("The canonical HTTPS origin is not configured. Use manual lookup."); return; }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setMessage("Camera scanning requires a supported browser and a secure HTTPS connection. Use manual lookup."); return; }
    const current = ++generation.current;
    setCamera(true);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      if (generation.current !== current || !video.current) return;
      const reader = new BrowserQRCodeReader();
      const active = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } }, audio: false }, video.current, (result) => {
        if (!result || generation.current !== current) return;
        const path = scannedBoxPath(result.getText(), origin);
        if (!path) { setMessage("This QR code is not a recognized MATMS box label. Try again or use manual lookup."); return; }
        stop(); router.push(path as Route);
      });
      if (generation.current !== current) active.stop(); else controls.current = active;
    } catch (error) {
      if (generation.current !== current) return;
      stop();
      const name = error instanceof Error ? error.name : "";
      setMessage(name === "NotAllowedError" || name === "PermissionDeniedError" ? "Camera permission was denied. Allow access and retry, or use manual lookup." : name === "NotFoundError" ? "No camera was found. Use manual lookup." : "The camera could not start. Retry or use manual lookup.");
    }
  }
  async function lookup(event: React.FormEvent) {
    event.preventDefault(); setMessage(""); setPending(true);
    try { const box = await client.archive.boxes.lookupCode({ code }); stop(); router.push(`/boxes/${box.id}`); }
    catch { setMessage("This box is unavailable. Check the code and try again."); }
    finally { setPending(false); }
  }
  return <section className="mx-auto w-full max-w-2xl space-y-6 p-6 sm:p-10"><div><h1 className="text-2xl font-semibold">Scan a box</h1><p className="text-sm text-muted-foreground">Scan a MATMS box label or enter its box code.</p></div><section className="space-y-3"><video ref={video} className={camera ? "aspect-video w-full rounded-lg bg-black object-cover" : "hidden"} muted playsInline aria-label="Camera preview" /><div className="flex gap-2">{camera ? <Button variant="outline" onClick={stop}>Stop camera</Button> : <Button onClick={() => void start()}>Start camera</Button>}</div></section>{message ? <p role="status" aria-live="polite">{message}</p> : null}<form onSubmit={(event) => void lookup(event)} className="space-y-3"><label className="block text-sm" htmlFor="manual-box-code">Box code</label><Input id="manual-box-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={64} required autoComplete="off" /><Button type="submit" disabled={pending}>{pending ? "Looking up…" : "Find box"}</Button></form></section>;
}
