import { Icon } from "@iconify/react";

/** A button's leading icon, swapped for a spinner while its action is pending. */
export function LoadingIcon({ pending, icon, className = "h-4 w-4" }: { pending: boolean; icon: string; className?: string }) {
  return pending ? (
    <Icon icon="feather:loader" className={`${className} animate-spin`} />
  ) : (
    <Icon icon={icon} className={className} />
  );
}
