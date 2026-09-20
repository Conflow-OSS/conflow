import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * Shows while near the top or scrolling up; hides while scrolling down past a
 * small threshold — the threshold avoids flicker on tiny scroll jitter (a
 * trackpad "bounce" or a sub-pixel scroll event shouldn't toggle visibility).
 * Watches `scrollRef`'s own scroll position, not `window` — this app's
 * scrollable region is `<main class="overflow-y-auto">`, not the document.
 */
export function useHideOnScroll(scrollRef: RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(true);
  const lastScrollTop = useRef(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const THRESHOLD = 8;

    function onScroll() {
      const top = el!.scrollTop;
      const delta = top - lastScrollTop.current;
      if (top <= 0) {
        setVisible(true);
        lastScrollTop.current = top;
      } else if (delta > THRESHOLD) {
        setVisible(false);
        lastScrollTop.current = top;
      } else if (delta < -THRESHOLD) {
        setVisible(true);
        lastScrollTop.current = top;
      }
    }

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollRef]);

  return visible;
}
