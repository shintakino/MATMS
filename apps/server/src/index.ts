import { appRouter } from "@matms/api/routers/index";
import { CustodialError, downloadCustodialReport, purgeExpiredCustodialImports, purgeExpiredCustodialReports, stageCustodialImport } from "@matms/api/custodial-service";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { createContext } from "./context";
import { ENV } from "./env.server";
import { getAuth, db } from "./services";
import { fileURLToPath } from "node:url";
import { z } from "zod";

type AppBindings = {
  Variables: {
    correlationId: string;
  };
};

const app = new Hono<AppBindings>();

app.use("*", async (c, next) => {
  const correlationId = c.req.header("x-correlation-id") ?? crypto.randomUUID();
  const startedAt = performance.now();

  c.set("correlationId", correlationId);
  c.header("x-correlation-id", correlationId);

  await next();

  console.info(
    JSON.stringify({
      level: "info",
      event: "http_request",
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      durationMs: Math.round(performance.now() - startedAt),
      correlationId,
    }),
  );
});
app.use(
  "/*",
  cors({
    origin: ENV.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", async (c) => (await getAuth()).auth.handler(c.req.raw));

let importUploadsInFlight = 0;
// Read only an authenticated, bounded binary body before invoking the isolated parser.
app.post("/api/custodial-imports", async (c) => {
  const context = await createContext({ context: c });
  if (!context.session?.user) return c.json({ code: "UNAUTHENTICATED", message: "Authentication is required." }, 401);
  if (!context.session.profile.active || context.session.profile.mustChangePassword || !["admin", "property_custodian"].includes(context.session.profile.role)) return c.json({ code: "FORBIDDEN", message: "This action is unavailable." }, 403);
  if (c.req.header("origin") !== ENV.CORS_ORIGIN || c.req.header("content-type") !== "application/octet-stream") return c.json({ code: "FORBIDDEN", message: "This request is unavailable." }, 403);
  const operationId = c.req.header("x-operation-id") ?? "";
  const classificationPolicyId = c.req.header("x-classification-policy-id") || undefined;
  let filename = "";
  try { filename = decodeURIComponent(c.req.header("x-file-name") ?? ""); } catch { return c.json({ code: "VALIDATION_ERROR", message: "Invalid filename." }, 400); }
  if (!z.uuid().safeParse(operationId).success || (classificationPolicyId && !z.uuid().safeParse(classificationPolicyId).success) || !filename || filename.length > 255 || /[\x00-\x1f/\\]/.test(filename)) return c.json({ code: "VALIDATION_ERROR", message: "Invalid upload details." }, 400);
  const limit = 8 * 1024 * 1024;
  const declared = c.req.header("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) return c.json({ code: "VALIDATION_ERROR", message: "Workbook size is unsupported." }, 413);
  const reader = c.req.raw.body?.getReader();
  if (!reader) return c.json({ code: "VALIDATION_ERROR", message: "Workbook is required." }, 400);
  if (importUploadsInFlight >= 2) return c.json({ code: "RATE_LIMITED", message: "Workbook inspection is busy; retry later." }, 429);
  importUploadsInFlight++;
  let timedOut = false;
  const deadline = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 15_000);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); return c.json({ code: "VALIDATION_ERROR", message: "Workbook size is unsupported." }, 413); }
      chunks.push(value);
    }
    if (timedOut) return c.json({ code: "VALIDATION_ERROR", message: "Workbook upload timed out." }, 408);
    clearTimeout(deadline);
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const worker = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./custodial-import-worker.ts" : "./custodial-import-worker.mjs", import.meta.url).href);
    const result = await stageCustodialImport(context.db, { id: context.session.user.id }, { filename, bytes, operationId, classificationPolicyId, correlationId: context.correlationId }, worker);
    return c.json(result, 200);
  } catch (error) {
    if (error instanceof CustodialError) return c.json({ code: error.code === "VALIDATION" ? "VALIDATION_ERROR" : error.code, message: error.message }, error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 400);
    return c.json({ code: "VALIDATION_ERROR", message: "Workbook is malformed, exceeds limits or is unsupported." }, 400);
  } finally { clearTimeout(deadline); importUploadsInFlight--; }
});

app.get("/api/inventory-reports/:id/download", async (c) => {
  const context = await createContext({ context: c });
  if (!context.session?.user) return c.json({ code: "UNAUTHENTICATED", message: "Authentication is required." }, 401);
  if (!z.uuid().safeParse(c.req.param("id")).success) return c.json({ code: "NOT_FOUND", message: "Report is unavailable." }, 404);
  try {
    const result = await downloadCustodialReport(context.db, { id: context.session.user.id }, c.req.param("id"), context.correlationId);
    c.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    c.header("Content-Disposition", `attachment; filename="${result.filename}"`);
    c.header("Cache-Control", "private, no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Content-SHA256", result.checksum);
    return c.body(new Uint8Array(result.bytes));
  } catch (error) {
    if (error instanceof CustodialError) return c.json({ code: error.code, message: error.message }, error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : error.code === "RATE_LIMITED" ? 429 : 400);
    return c.json({ code: "INTERNAL_ERROR", message: "Report could not be downloaded." }, 500);
  }
});

export const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

export const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

app.use("/*", async (c, next) => {
  const context = await createContext({ context: c });

  const rpcResult = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context: context,
  });

  if (rpcResult.matched) {
    return c.newResponse(rpcResult.response.body, rpcResult.response);
  }

  const apiResult = await apiHandler.handle(c.req.raw, {
    prefix: "/api-reference",
    context: context,
  });

  if (apiResult.matched) {
    return c.newResponse(apiResult.response.body, apiResult.response);
  }

  await next();
});

app.get("/", (c) => {
  return c.json({ service: "matms-api", status: "ok", correlationId: c.get("correlationId") });
});

app.get("/health/live", (c) => {
  return c.json({ status: "ok", correlationId: c.get("correlationId") });
});

app.get("/health/ready", async (c) => {
  try {
    await db.execute("select 1");
    return c.json({ status: "ok", correlationId: c.get("correlationId") });
  } catch {
    return c.json(
      { status: "unavailable", correlationId: c.get("correlationId") },
      503,
    );
  }
});

app.onError((error, c) => {
  const correlationId = c.get("correlationId") ?? crypto.randomUUID();
  console.error(
    JSON.stringify({
      level: "error",
      event: "unhandled_request_error",
      errorName: error.name,
      correlationId,
    }),
  );

  return c.json(
    {
      code: "INTERNAL_ERROR",
      message: "The request could not be completed.",
      correlationId,
    },
    500,
  );
});

const port = Number(process.env.PORT ?? 3000);

Bun.serve({
  fetch: app.fetch,
  port,
  hostname: process.env.MATMS_BIND_HOST ?? "0.0.0.0",
});

console.info(JSON.stringify({ level: "info", event: "server_started", port }));

// Cleanup is bounded and coordinated across replicas by row locks.
const purgeImports = () => void purgeExpiredCustodialImports(db).catch((error: unknown) => {
  console.error(JSON.stringify({ level: "error", event: "import_expiry_failed", errorName: error instanceof Error ? error.name : "UnknownError" }));
});
const purgeReports = () => void purgeExpiredCustodialReports(db).catch((error: unknown) => {
  console.error(JSON.stringify({ level: "error", event: "report_expiry_failed", errorName: error instanceof Error ? error.name : "UnknownError" }));
});
purgeImports();
purgeReports();
setInterval(purgeImports, 60 * 60 * 1000).unref();
setInterval(purgeReports, 60 * 60 * 1000).unref();

export { app };
