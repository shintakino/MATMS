import { AppShell } from "@/components/app-shell";
import { BookingWorkspace } from "@/components/booking-workspace";
import { requireIdentity } from "@/lib/require-identity";
import { bookingReturnPath } from "@/lib/booking-return-path";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const identity = await requireIdentity(bookingReturnPath("/bookings", await searchParams));
  return <AppShell role={identity.role} userName={identity.name}><BookingWorkspace kind="resource" role={identity.role} /></AppShell>;
}
