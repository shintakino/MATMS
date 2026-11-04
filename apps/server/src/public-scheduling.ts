import { isIP } from "node:net";
import type { MiddlewareHandler } from "hono";
import type { Database } from "@matms/db";
import { consumeSchedulingPublicAttempt } from "@matms/api/scheduling-invitation-service";
import { MatmsError } from "@matms/api/errors";

/** Capability requests use bounded POST bodies, never query strings or URL paths. */
export function publicSchedulingGuard(db: Database, origin: string): MiddlewareHandler {
  return async (c, next) => {
    let path: string;
    try { path = decodeURIComponent(new URL(c.req.url).pathname); } catch { return c.json({ message: "Invalid request." }, 400); }
    if (!/^\/(rpc|api-reference)\/scheduling\/invitation(Preview|Availability|Submit)\/?$/.test(path)) return next();
    c.header("Cache-Control", "private, no-store"); c.header("Referrer-Policy", "no-referrer");
    if (c.req.method !== "POST") return c.json({ message: "Use a POST request." }, 405);
    if (c.req.header("origin") !== origin || new URL(c.req.url).search) return c.json({ message: "This request is unavailable." }, 403);
    if (c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return c.json({ message: "A JSON request is required." }, 415);
    const address = c.req.header("cf-connecting-ip") ?? "";
    try { await consumeSchedulingPublicAttempt(db, isIP(address) ? address : "direct-shared"); }
    catch (error) {
      if (error instanceof MatmsError && error.code === "RATE_LIMITED") { c.header("Retry-After", "60"); return c.json({ message: error.message }, 429); }
      throw error;
    }
    const declared = c.req.header("content-length"), max = 16384;
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > max)) return c.json({ message: "Request body is too large." }, 413);
    const reader = c.req.raw.body?.getReader();
    if (!reader) return c.json({ message: "A request body is required." }, 400);
    let timedOut = false, size = 0;
    const chunks: Uint8Array[] = [];
    const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 5000);
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) { await reader.cancel(); return c.json({ message: "Request body is too large." }, 413); }
        chunks.push(value);
      }
      if (timedOut) return c.json({ message: "Request body timed out." }, 408);
      const body = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      c.req.raw = new Request(c.req.raw, { body });
    } catch { return c.json({ message: "Request body could not be read." }, 400); }
    finally { clearTimeout(timer); }
    return next();
  };
}
