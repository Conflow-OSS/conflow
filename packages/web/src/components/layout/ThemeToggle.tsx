import { Icon } from "@iconify/react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggleTheme}
    >
      <Icon icon={theme === "dark" ? "feather:sun" : "feather:moon"} className="h-4 w-4" />
    </Button>
  );
}
