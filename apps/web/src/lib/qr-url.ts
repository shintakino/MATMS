const boxPath = /^\/boxes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Only a configured HTTPS origin, without path, credentials, query or fragment, is usable. */
export function canonicalOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

export function scannedBoxPath(value: string, origin: string | null): string | null {
  if (!origin) return null;
  try {
    const url = new URL(value);
    if (url.origin !== origin || url.username || url.password || url.search || url.hash || !boxPath.test(url.pathname)) return null;
    return url.pathname;
  } catch { return null; }
}
