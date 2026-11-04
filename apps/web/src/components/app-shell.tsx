"use client";

import { Button } from "@matms/ui/components/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@matms/ui/components/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@matms/ui/components/dropdown-menu";
import { Separator } from "@matms/ui/components/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "@matms/ui/components/sidebar";
import {
  ArchiveIcon,
  ArrowUpRightIcon,
  SearchIcon,
  ScanLineIcon,
  PrinterIcon,
  PackageIcon,
  HandshakeIcon,
  ChartNoAxesCombinedIcon,
  ChevronDownIcon,
  BoxIcon,
  ClipboardListIcon,
  CalendarDaysIcon,
  Building2Icon,
  FileTextIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type * as React from "react";

import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";

export type NavigationRole = "admin" | "property_custodian" | "staff" | "viewer";

type NavigationItem = {
  label: string;
  icon: LucideIcon;
  roles: NavigationRole[];
  href?: string;
  current?: boolean;
};

const primaryNavigation: NavigationItem[] = [
  { label: "Leave", icon: CalendarDaysIcon, roles: ["admin", "property_custodian", "staff", "viewer"], href: "/leave" },
  { label: "Bookings", icon: Building2Icon, roles: ["admin", "property_custodian", "staff", "viewer"], href: "/bookings" },
  { label: "Dashboard", icon: LayoutDashboardIcon, roles: ["admin", "property_custodian", "staff", "viewer"], href: "/dashboard", current: true },
  { label: "Boxes", icon: BoxIcon, roles: ["admin", "property_custodian", "staff", "viewer"], href: "/boxes" },
  { label: "Documents", icon: FileTextIcon, roles: ["admin", "property_custodian", "staff", "viewer"], href: "/documents" },
  { label: "Search", icon: SearchIcon, roles: ["admin", "property_custodian", "staff", "viewer"], href: "/search" },
  { label: "Scan box", icon: ScanLineIcon, roles: ["admin", "property_custodian", "staff", "viewer"], href: "/scan" },
  { label: "Print labels", icon: PrinterIcon, roles: ["admin", "property_custodian", "staff"], href: "/labels" },
  { label: "Templates", icon: ArchiveIcon, roles: ["admin", "property_custodian", "staff", "viewer"], href: "/templates" },
  { label: "Property inventory", icon: PackageIcon, roles: ["admin", "property_custodian", "staff", "viewer"], href: "/property-inventory" },
  { label: "Requests", icon: ClipboardListIcon, roles: ["admin", "property_custodian", "staff"], href: "/requests" },
  { label: "Loans", icon: HandshakeIcon, roles: ["admin", "property_custodian", "staff"], href: "/loans" },
  { label: "Reports", icon: ChartNoAxesCombinedIcon, roles: ["admin", "property_custodian", "staff"], href: "/reports" },
];

const adminNavigation: NavigationItem[] = [
  { label: "Leave setup", icon: CalendarDaysIcon, roles: ["admin"], href: "/admin/scheduling" },
  { label: "Users", icon: UsersIcon, roles: ["admin"], href: "/admin/users" },
  { label: "Archive setup", icon: ArchiveIcon, roles: ["admin"], href: "/admin/archive" },
  { label: "Access", icon: ShieldCheckIcon, roles: ["admin"], href: "/admin/access" },
  { label: "Audit", icon: ClipboardListIcon, roles: ["admin"], href: "/admin/audit" },
  { label: "Settings", icon: SettingsIcon, roles: ["admin"], href: "/admin/settings" },
];

function NavigationGroup({ items, role, label }: { items: NavigationItem[]; role: NavigationRole; label: string }) {
  const pathname = usePathname();
  const visibleItems = items.filter((item) => item.roles.includes(role));

  if (!visibleItems.length) {
    return null;
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const current = pathname === item.href || !!(item.href && pathname.startsWith(`${item.href}/`));
            return (
              <SidebarMenuItem key={item.label}>
                <SidebarMenuButton
                  className="h-10 rounded-lg px-3 text-[13px] transition-colors data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-sidebar-accent-foreground"
                  isActive={current}
                  tooltip={item.label}
                  render={item.href ? <a href={item.href} aria-current={current ? "page" : undefined} /> : <button type="button" disabled />}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AppShell({
  children,
  role = "staff",
  userName,
}: {
  children: React.ReactNode;
  role?: NavigationRole;
  userName?: string;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const currentLabel = [...primaryNavigation, ...adminNavigation].find((item) => pathname === item.href || !!(item.href && pathname.startsWith(`${item.href}/`)))?.label ?? "Workspace";
  const settings = useQuery({ queryKey: ["school-settings"], queryFn: () => client.admin.settings.get() });

  useEffect(() => {
    let lastAttempt = 0;
    let inFlight = false;
    const refreshOnActivity = () => {
      const now = Date.now();
      if (document.visibilityState !== "visible" || inFlight || now - lastAttempt < 60_000) return;
      lastAttempt = now;
      inFlight = true;
      void client.identity.me().catch(() => {}).finally(() => { inFlight = false; });
    };
    refreshOnActivity();
    window.addEventListener("pointerdown", refreshOnActivity);
    window.addEventListener("keydown", refreshOnActivity);
    return () => {
      window.removeEventListener("pointerdown", refreshOnActivity);
      window.removeEventListener("keydown", refreshOnActivity);
    };
  }, []);

  async function signOut() {
    await authClient.signOut();
    await queryClient.cancelQueries();
    queryClient.clear();
    router.replace(`/login?returnTo=${encodeURIComponent(pathname)}` as Route);
    router.refresh();
  }

  return (
    <SidebarProvider className="matms-shell">
      <a href="#main-content" className="sr-only z-50 rounded-md bg-primary p-3 text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
      <Sidebar collapsible="offcanvas">
        <SidebarHeader className="gap-3 px-5 py-6">
          <a href="/dashboard" className="flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm"><ArchiveIcon aria-hidden="true" className="size-5" /></span>
            <span><span className="block text-lg font-bold tracking-tight">MATMS</span><span className="block text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">School workspace</span></span>
          </a>
          <p className="text-xs leading-relaxed text-muted-foreground">{settings.data?.schoolName ?? "Meocan High School"}</p>
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarContent>
          <NavigationGroup items={primaryNavigation.filter((item) => ["Dashboard", "Search"].includes(item.label))} label="Overview" role={role} />
          <NavigationGroup items={primaryNavigation.filter((item) => ["Boxes", "Documents", "Templates", "Property inventory"].includes(item.label))} label="Records & inventory" role={role} />
          <NavigationGroup items={primaryNavigation.filter((item) => ["Leave", "Bookings", "Requests", "Loans", "Reports", "Scan box", "Print labels"].includes(item.label))} label="Operations" role={role} />
          <NavigationGroup items={adminNavigation} label="Administration" role={role} />
        </SidebarContent>
        <SidebarFooter>
          <div className="mx-2 mb-2 rounded-xl border bg-background p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Your workspace role</p><p className="mt-1 text-xs font-medium capitalize">{role.replaceAll("_", " ")}</p></div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="workspace-topbar sticky top-0 z-20 flex min-h-17 items-center gap-3 border-b border-border bg-card/95 px-4 backdrop-blur-sm sm:px-8">
          <SidebarTrigger aria-label="Toggle navigation" />
          <Separator orientation="vertical" className="h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden sm:block">Workspace</BreadcrumbItem>
              <BreadcrumbSeparator className="hidden sm:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>{currentLabel}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-3">
            <a href="/search" aria-label="Search records" className="hidden items-center gap-2 rounded-lg border bg-background px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:flex"><SearchIcon aria-hidden="true" className="size-3.5" />Find a record<ArrowUpRightIcon aria-hidden="true" className="ml-5 size-3" /></a>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button aria-label="Open user menu" size="sm" variant="ghost" />}>
                <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{(userName ?? "M").slice(0, 1).toUpperCase()}</span><span className="hidden sm:inline">{userName ?? "Workspace"}</span><ChevronDownIcon aria-hidden="true" className="size-3 text-muted-foreground" />
                <span className="sm:hidden">Menu</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup><DropdownMenuLabel>{userName ?? "MATMS workspace"}</DropdownMenuLabel></DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>Role: {role}</DropdownMenuItem>
                <DropdownMenuItem onClick={signOut}>Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main id="main-content" className="workspace-content flex min-w-0 flex-1 flex-col">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
