import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import type { WorkbookInspection } from "./custodial-workbook-inspection";
import { z } from "zod";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT = 16 * 1024 * 1024;
const TIMEOUT_MS = 15000;
let running = 0;
const evidence = z.object({ address: z.string().regex(/^[A-Z]{1,3}[1-9]\d{0,3}$/), value: z.union([z.string().max(10000), z.number().finite(), z.boolean(), z.null()]), formula: z.string().max(10000).nullable(), kind: z.enum(["number", "text", "boolean", "missing", "other"]) }).strict();
const inspection = z.object({ family: z.enum(["stock_card", "rpcsp", "rpcppe"]), sourceHash: z.string().regex(/^[0-9a-f]{64}$/), sheets: z.array(z.object({ name: z.string().min(1).max(31), rows: z.array(z.object({ sheet: z.string().min(1).max(31), row: z.number().int().min(1).max(5000), section: z.string().max(10000).nullable(), fields: z.record(z.string().max(100), evidence), warnings: z.array(z.string().max(300)).max(100), variance: z.object({ quantity: z.number().int(), value: z.string().regex(/^-?\d+\.\d{2}$/).nullable() }).strict().nullable() }).strict()).max(5000), metadata: z.record(z.string().max(10), evidence), signatures: z.array(evidence).max(1800) }).strict()).min(1).max(3), warnings: z.array(z.string().max(300)).max(5000) }).strict();

/** The caller supplies an application-owned worker path, never a user-provided executable. */
export async function inspectIsolatedInventoryWorkbook(bytes: Uint8Array, filename: string, workerPath: string, classificationThreshold?: string, timeoutMs = TIMEOUT_MS): Promise<WorkbookInspection> {
  if (process.platform !== "linux" || !bytes.length || bytes.length > MAX_BYTES || filename.length > 255 || /[\x00-\x1f/\\]/.test(filename)) throw new Error("Workbook is unavailable or unsupported.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > TIMEOUT_MS) throw new Error("Workbook inspection timeout is invalid.");
  if (running >= 2) throw new Error("Workbook inspection is busy; retry later.");
  running++;
  try {
    const encoded = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
    const request = JSON.stringify({ filename, data: encoded, classificationThreshold });
    return await new Promise((resolve, reject) => {
      // The fixed shell script sets an address-space limit; user content is sent only on stdin.
      const child = spawn("/bin/sh", ["-c", 'ulimit -v 524288 || exit 70; exec "$@"', "matms-workbook-parser", process.execPath, workerPath], { stdio: ["pipe", "pipe", "ignore"], env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" } });
      const events = child as unknown as { on(event: "error", listener: (error: Error) => void): void; on(event: "close", listener: (code: number | null) => void): void };
      let finished = false, failed = false, length = 0;
      const chunks: Uint8Array[] = [];
      const timer = setTimeout(() => fail(), timeoutMs);
      function fail() {
        if (finished || failed) return;
        failed = true; clearTimeout(timer); child.kill("SIGKILL");
      }
      events.on("error", fail);
      child.stdin.on("error", fail);
      child.stdout.on("error", fail);
      child.stdout.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > MAX_OUTPUT) return fail();
        chunks.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      });
      events.on("close", (code) => {
        if (finished) return;
        if (failed || code !== 0) { finished = true; clearTimeout(timer); reject(new Error("Workbook is malformed, exceeds limits or is unsupported.")); return; }
        try {
          const response = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { ok?: unknown; result?: unknown };
          const parsed = inspection.safeParse(response.result);
          if (response.ok !== true || !parsed.success) throw new Error("Invalid worker result.");
          finished = true; clearTimeout(timer); resolve(parsed.data as WorkbookInspection);
        } catch { finished = true; clearTimeout(timer); reject(new Error("Workbook is malformed, exceeds limits or is unsupported.")); }
      });
      child.stdin.end(request);
    });
  } finally { running--; }
}
