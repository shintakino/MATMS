/** Code text retains user-entered hyphens; uniqueness is normalized separately. */
export function formatCustodialItemCode(code: string, now = new Date()): string {
  const value = code.trim();
  if (/-\d{4}$/.test(value)) return value;
  const year = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric" }).format(now);
  return `${value}-${year}`;
}
