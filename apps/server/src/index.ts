import { appRouter } from "@matms/api/routers/index";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { createContext } from "./context";
import { ENV } from "./env.server";
import { auth, db } from "./services";

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

app.on(["POST", "GET"], "/api/auth/*", async (c) => auth.handler(c.req.raw));

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
});

console.info(JSON.stringify({ level: "info", event: "server_started", port }));

export default app;
