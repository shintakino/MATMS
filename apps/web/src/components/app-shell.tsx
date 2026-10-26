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
  BoxIcon,
  ClipboardListIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type * as React from "react";

import { authClient } from "@/lib/auth-client";

export type NavigationRole = "admin" | "staff" | "viewer";

type NavigationItem = {
  label: string;
  icon: LucideIcon;
  roles: NavigationRole[];
  href?: string;
  current?: boolean;
};

const primaryNavigation: NavigationItem[] = [
  { label: "Dashboard", icon: LayoutDashboardIcon, roles: ["admin", "staff", "viewer"], href: "/dashboard", current: true },
  { label: "Boxes", icon: BoxIcon, roles: ["admin", "staff", "viewer"], href: "/boxes" },
  { label: "Documents", icon: FileTextIcon, roles: ["admin", "staff", "viewer"], href: "/documents" },
  { label: "Templates", icon: ArchiveIcon, roles: ["admin", "staff", "viewer"], href: "/templates" },
  { label: "Requests & Loans", icon: ClipboardListIcon, roles: ["admin", "staff", "viewer"] },
  { label: "Reports", icon: LayoutDashboardIcon, roles: ["admin", "staff"] },
];

const adminNavigation: NavigationItem[] = [
  { label: "Users", icon: UsersIcon, roles: ["admin"], href: "/admin/users" },
  { label: "Archive setup", icon: ArchiveIcon, roles: ["admin"], href: "/admin/archive" },
  { label: "Access", icon: ShieldCheckIcon, roles: ["admin"] },
  { label: "Audit", icon: ClipboardListIcon, roles: ["admin"] },
  { label: "Settings", icon: SettingsIcon, roles: ["admin"] },
];

function NavigationGroup({ items, role, label }: { items: NavigationItem[]; role: NavigationRole; label: string }) {
  const visibleItems = items.filter((item) => item.roles.includes(role));

  if (!visibleItems.length) {
    return null;
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {visibleItems.map((item) => {
            const Icon = item.icon;
            return (
              <SidebarMenuItem key={item.label}>
                <SidebarMenuButton
                  isActive={item.current}
                  tooltip={item.label}
                  render={item.href ? <a href={item.href} aria-current={item.current ? "page" : undefined} /> : <button type="button" disabled />}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                  {!item.current ? <span className="sr-only">Available in a later feature</span> : null}
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
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="offcanvas">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1">
            <ArchiveIcon aria-hidden="true" className="size-4" />
            <span className="font-medium">MATMS</span>
          </div>
          <p className="px-2 text-xs text-sidebar-foreground/70">Meocan High School</p>
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarContent>
          <NavigationGroup items={primaryNavigation} label="Workspace" role={role} />
          <NavigationGroup items={adminNavigation} label="Administration" role={role} />
        </SidebarContent>
        <SidebarFooter>
          <p className="px-2 text-xs text-sidebar-foreground/70">Role: {role}</p>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex min-h-14 items-center gap-3 border-b border-border px-4 sm:px-6">
          <SidebarTrigger aria-label="Toggle navigation" />
          <Separator orientation="vertical" className="h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden sm:block">Workspace</BreadcrumbItem>
              <BreadcrumbSeparator className="hidden sm:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>Dashboard</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button aria-label="Open user menu" size="sm" variant="outline" />}>
                <span className="hidden sm:inline">{userName ?? "Workspace"}</span>
                <span className="sm:hidden">Menu</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{userName ?? "MATMS workspace"}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>Role: {role}</DropdownMenuItem>
                <DropdownMenuItem onClick={signOut}>Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
