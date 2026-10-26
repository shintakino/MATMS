import type { Metadata } from "next";
import "../index.css";
import Providers from "@/components/providers";

export const metadata: Metadata = {
  title: "MATMS",
  description: "Meocan Archive & Template Management System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-svh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
