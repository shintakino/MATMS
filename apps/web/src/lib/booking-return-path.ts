/** Carry only bounded planning fields through sign-in; the destination is fixed. */
export function bookingReturnPath(path: "/leave" | "/bookings", query: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();
  for (const key of ["start", "end", "resource"] as const) {
    const value = query[key];
    if (typeof value === "string" && value.length <= 64) params.set(key, value);
  }
  return params.size ? `${path}?${params}` : path;
}
