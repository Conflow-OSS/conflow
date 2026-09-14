export interface PostSelection {
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}
