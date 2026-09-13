// Single source of truth for the three browsing destinations — rendered as
// a Sidebar on desktop/tablet and a bottom tab bar on phone. Deliberately
// three, not four: "Generate a run" is an action (a FAB / sidebar button),
// not a place to browse, so it isn't in this list — see AppShell.
export interface NavItem {
  to: string;
  label: string;
  icon: string; // feather icon name, via @iconify/react
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/runs", label: "Runs", icon: "feather:list" },
  { to: "/posts", label: "Posts", icon: "feather:file-text" },
  { to: "/seed", label: "Seed corpus", icon: "feather:database" },
];
