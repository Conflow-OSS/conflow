import { useEffect, useState } from "react";

// Matches the sidebar/bottom-nav breakpoint in AppShell (md: = 768px).
const QUERY = "(max-width: 767px)";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(QUERY).matches);

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const handler = () => setIsMobile(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isMobile;
}
