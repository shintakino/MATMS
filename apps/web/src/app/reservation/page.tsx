import type { Metadata } from "next";
import { PublicReservation } from "@/components/public-reservation";

export const metadata: Metadata = { title: "Public request · MATMS", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };
export default function Page() { return <main className="min-h-svh bg-background"><PublicReservation /></main>; }
