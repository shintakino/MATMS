const localOrigin = "http://matms.local";

/**
 * Keeps authentication continuations inside MATMS. Query-string return targets
 * are untrusted input and must never become an external redirect.
 */
export function safeReturnPath(value: string | null | undefined, fallback = "/dashboard") {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }

  try {
    const target = new URL(value, localOrigin);
    if (target.origin !== localOrigin) {
      return fallback;
    }

    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
