import { Icon } from "@iconify/react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav-items";

/**
 * Phone-only (hidden at md: and up — see AppShell). Deliberately excluded
 * from the post-detail route: that's a focused single-task screen, not a
 * moment for switching top-level sections, so it gets a plain back-header
 * instead (see PostDetailPage once M4 builds it).
 */
export function BottomNav() {
  return (
    <nav
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around md:hidden",
        "border-t border-border bg-card/90 backdrop-blur-md [box-shadow:var(--shadow-l)]",
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            cn(
              "flex flex-1 flex-col items-center gap-1 py-2.5 text-xs",
              "transition-colors duration-150",
              isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )
          }
        >
          <Icon icon={item.icon} className="h-5 w-5" />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
