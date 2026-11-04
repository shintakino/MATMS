import { describe, expect, test } from "bun:test";
import { canonicalOrigin, scannedBoxPath } from "../apps/web/src/lib/qr-url";
import { safeReturnPath } from "../apps/web/src/lib/return-path";

describe("QR origins and destinations", () => {
  const id = "c086bf3f-6ff2-4aca-a359-7f996b464258";
  const origin = canonicalOrigin("https://archive.example.edu/");
  test("accepts only configured HTTPS origins and box routes", () => {
    expect(origin).toBe("https://archive.example.edu");
    for (const value of ["http://archive.example.edu", "https://archive.example.edu/path", "https://user@archive.example.edu", "https://archive.example.edu/?a=1"]) expect(canonicalOrigin(value)).toBeNull();
    expect(scannedBoxPath(`${origin}/boxes/${id}`, origin)).toBe(`/boxes/${id}`);
    for (const value of [`https://evil.test/boxes/${id}`, `https://archive.example.edu.evil.test/boxes/${id}`, `${origin}/boxes/not-a-uuid`, `${origin}/boxes/${id}?next=https://evil.test`, `${origin}/boxes/${id}#x`, `https://user@archive.example.edu/boxes/${id}`]) expect(scannedBoxPath(value, origin)).toBeNull();
    expect(scannedBoxPath(`${origin}/boxes/${id}`, null)).toBeNull();
  });
  test("keeps login continuation local", () => {
    expect(safeReturnPath(`/boxes/${id}`)).toBe(`/boxes/${id}`);
    expect(safeReturnPath("//evil.test")).toBe("/dashboard");
  });
});
