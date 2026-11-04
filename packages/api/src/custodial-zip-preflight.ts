import { Buffer } from "node:buffer";
import type { Readable } from "node:stream";
import * as yauzl from "yauzl";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 512;
const MAX_PARSE_MS = 10000;

/** Stream each XLSX entry before parsing. This is one layer, not a complete upload sandbox. */
export async function preflightCustodialXlsx(bytes: Uint8Array, options: { maxExpandedBytes?: number } = {}): Promise<{ entryCount: number; expandedBytes: number }> {
  if (bytes.length < 4 || bytes.length > MAX_UPLOAD_BYTES || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) throw new Error("Workbook archive is invalid or too large.");
  const limit = options.maxExpandedBytes ?? MAX_EXPANDED_BYTES;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_EXPANDED_BYTES) throw new Error("Workbook archive limit is invalid.");
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return new Promise((resolve, reject) => {
    let zip: yauzl.ZipFile | undefined;
    let activeStream: Readable | undefined;
    let finished = false;
    let entryCount = 0;
    let expandedBytes = 0;
    const paths = new Set<string>();
    const timer = setTimeout(() => fail(), MAX_PARSE_MS);
    function fail() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      activeStream?.destroy();
      zip?.close();
      reject(new Error("Workbook archive is malformed or contains unsupported content."));
    }
    yauzl.fromBuffer(buffer, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, opened) => {
      if (finished) { opened?.close(); return; }
      if (error || !opened) return fail();
      zip = opened;
      zip.on("error", fail);
      zip.on("end", () => {
        if (finished) return;
        if (!paths.has("[content_types].xml") || !paths.has("xl/workbook.xml")) return fail();
        finished = true;
        clearTimeout(timer);
        resolve({ entryCount, expandedBytes });
      });
      zip.on("entry", (entry: yauzl.Entry) => {
        if (finished) return;
        entryCount++;
        const name = entry.fileName.toLowerCase();
        if (entryCount > MAX_ENTRIES || name.length > 256 || paths.has(name) || (entry.generalPurposeBitFlag & 1) !== 0 || entry.uncompressedSize > MAX_ENTRY_BYTES || expandedBytes + entry.uncompressedSize > limit || /(^|\/)(vbaproject\.bin|vba|macrosheets|activex|externallinks|embeddings)(\/|$)/i.test(name)) return fail();
        paths.add(name);
        if (name.endsWith("/")) { zip!.readEntry(); return; }
        zip!.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream || finished) return fail();
          activeStream = stream;
          let size = 0;
          const inspectXml = name.endsWith(".xml") || name.endsWith(".rels");
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_ENTRY_BYTES || expandedBytes + size > limit) return fail();
            if (inspectXml) chunks.push(chunk);
          });
          stream.on("error", fail);
          stream.on("end", () => {
            if (finished) return;
            expandedBytes += size;
            activeStream = undefined;
            if (inspectXml) {
              const content = Buffer.concat(chunks.map((chunk) => new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength))).toString("utf8");
              if (name === "[content_types].xml" && content.includes("&")) return fail();
              if (content.includes("\u0000") || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(content) || /targetmode\s*=/i.test(content) || /<override\b[^>]*(?:macroenabled|vnd\.ms-office\.vba)[^>]*>/i.test(content) || /<default\b(?=[^>]*\bextension\s*=\s*["']xml["'])[^>]*(?:macroenabled|vnd\.ms-office\.vba)[^>]*>/i.test(content)) return fail();
            }
            zip!.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}
