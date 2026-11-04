import { inspectTrustedInventoryWorkbook } from "@matms/api/custodial-workbook-inspection";
import { preflightCustodialXlsx } from "@matms/api/custodial-zip-preflight";

const MAX_REQUEST = 12 * 1024 * 1024;
const chunks: Uint8Array[] = [];
let size = 0;
try {
  for await (const chunk of process.stdin) {
    const bytes = new Uint8Array(chunk);
    size += bytes.byteLength;
    if (size > MAX_REQUEST) throw new Error("Request is too large.");
    chunks.push(bytes);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  const input: unknown = JSON.parse(raw);
  if (!input || typeof input !== "object") throw new Error("Invalid request.");
  const { filename, data, classificationThreshold } = input as Record<string, unknown>;
  if (typeof filename !== "string" || filename.length > 255 || typeof data !== "string" || data.length > MAX_REQUEST || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || (classificationThreshold !== undefined && typeof classificationThreshold !== "string")) throw new Error("Invalid request.");
  const buffer = Buffer.from(data, "base64");
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (filename.toLowerCase().endsWith(".xlsx")) await preflightCustodialXlsx(bytes);
  const result = inspectTrustedInventoryWorkbook(bytes, filename, { classificationThreshold: classificationThreshold as string | undefined });
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch {
  process.stdout.write(JSON.stringify({ ok: false }));
  process.exitCode = 1;
}
