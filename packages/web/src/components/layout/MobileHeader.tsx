import { Icon } from "@iconify/react";
import type { RefObject } from "react";
import { NavLink } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useHideOnScroll } from "./useHideOnScroll";

/**
 * Phone-only floating header (md:hidden — see AppShell). Desktop/tablet gets
 * the Personalize icon in the Sidebar footer instead; there's no top bar on
 * that breakpoint. Hides on scroll-down, reappears on scroll-up, so it's
 * reachable without scrolling all the way back to the top.
 */
export function MobileHeader({ scrollRef }: { scrollRef: RefObject<HTMLElement | null> }) {
  const visible = useHideOnScroll(scrollRef);

  return (
    <header
      className={cn(
        "fixed inset-x-3 top-3 z-40 md:hidden",
        "flex items-center justify-between rounded-2xl px-4 py-2.5",
        "border border-border/50 bg-card/70 backdrop-blur-md [box-shadow:var(--shadow-m)]",
        "transition-transform duration-200",
        visible ? "translate-y-0" : "-translate-y-[calc(100%+1rem)]",
      )}
    >
      <span className="text-sm font-semibold tracking-tight">ConFlow</span>
      <Button asChild variant="ghost" size="icon" aria-label="Personalize">
        <NavLink to="/personalization">
          <Icon icon="feather:user" className="h-5 w-5" />
        </NavLink>
      </Button>
    </header>
  );
}
