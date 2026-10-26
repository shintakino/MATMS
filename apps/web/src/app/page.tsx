import { redirect } from "next/navigation";
import type { Route } from "next";

export default function HomePage() {
  redirect("/dashboard" as Route);
}
