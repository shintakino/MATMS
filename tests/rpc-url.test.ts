import { expect, test } from "bun:test";

test("browser RPC calls use an absolute URL on the current origin", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  try {
    Object.defineProperty(globalThis, "window", { value: { location: { origin: "https://preview.example.test" } }, configurable: true });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestedUrl = input instanceof Request ? input.url : String(input);
      return new Response("{}", { status: 500 });
    }) as typeof fetch;
    const { client } = await import("../apps/web/src/utils/orpc");
    try { await client.identity.me(); } catch { /* The stub intentionally returns an error. */ }
    expect(requestedUrl).toBe("https://preview.example.test/rpc/identity/me");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
  }
});
