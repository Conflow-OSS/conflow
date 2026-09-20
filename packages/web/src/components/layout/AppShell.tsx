import { Icon } from "@iconify/react";
import { useRef } from "react";
import { NavLink, Outlet, matchPath, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { useHealth } from "@/hooks/useHealth";
import { cn } from "@/lib/utils";
import { BottomNav } from "./BottomNav";
import { MobileHeader } from "./MobileHeader";
import { NAV_ITEMS } from "./nav-items";
import { ThemeToggle } from "./ThemeToggle";

// The post detail route is a focused, single-task screen on mobile (a full
// page, not a panel) — the bottom tab bar would just compete with it for
// space over a task that isn't "switch to a different section."
const HIDE_MOBILE_NAV_PATTERNS = ["/posts/:postId"];

export function AppShell() {
  const location = useLocation();
  const hideMobileNav = HIDE_MOBILE_NAV_PATTERNS.some((pattern) => matchPath(pattern, location.pathname));
  const health = useHealth();
  const status = health.isLoading ? "idle" : health.data?.ok ? "online" : "offline";
  const statusLabel = health.isLoading ? "Checking…" : health.data?.ok ? "Connected" : "Unreachable";
  const mainRef = useRef<HTMLElement>(null);

  return (
    <div className="flex h-svh overflow-hidden bg-background text-foreground">
      {/* Desktop / tablet — sidebar, ≥768px (md:) */}
      <Sidebar className="hidden md:flex">
        <SidebarHeader>
          <span className="text-sm font-semibold tracking-tight">Conflow</span>
        </SidebarHeader>
        <SidebarContent>
          <div className="mb-3">
            <Button asChild className="w-full justify-center" variant="primary">
              <NavLink to="/generate">
                <Icon icon="feather:plus" className="h-4 w-4" />
                Generate a run
              </NavLink>
            </Button>
          </div>
          <SidebarGroup>
            <SidebarGroupLabel>Browse</SidebarGroupLabel>
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 w-full rounded-md px-2 py-1.5 text-sm",
                    "transition-[background-color,color,box-shadow] duration-150",
                    "text-muted-foreground hover:bg-accent hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                    isActive && "bg-accent text-foreground [box-shadow:var(--shadow-s)]",
                  )
                }
              >
                <Icon icon={item.icon} className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
              </NavLink>
            ))}
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="flex items-center justify-between">
          <StatusIndicator status={status} label={statusLabel} />
          <div className="flex items-center">
            <Button asChild variant="ghost" size="icon" aria-label="Personalize">
              <NavLink to="/personalization">
                <Icon icon="feather:user" className="h-4 w-4" />
              </NavLink>
            </Button>
            <ThemeToggle />
          </div>
        </SidebarFooter>
      </Sidebar>

      <div className="flex min-w-0 flex-1 flex-col">
        <main
          ref={mainRef}
          className={cn("flex-1 overflow-y-auto", !hideMobileNav && "pb-16 pt-16 md:pb-0 md:pt-0")}
        >
          <Outlet />
        </main>
      </div>

      {/* Phone — floating header, bottom tab bar, and a floating Generate action, below 768px.
          All hidden together on the focused post-detail screen, which has its own back-header. */}
      {!hideMobileNav && (
        <>
          <MobileHeader scrollRef={mainRef} />
          <BottomNav />
          <Button
            asChild
            size="icon"
            variant="primary"
            className="fixed bottom-20 right-4 z-50 h-12 w-12 rounded-full md:hidden"
          >
            <NavLink to="/generate" aria-label="Generate a run">
              <Icon icon="feather:plus" className="h-5 w-5" />
            </NavLink>
          </Button>
        </>
      )}
    </div>
  );
}
