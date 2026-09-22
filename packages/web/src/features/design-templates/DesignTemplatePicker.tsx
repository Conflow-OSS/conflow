import type { DesignTemplateRow } from "@content-engine/shared";
import { Icon } from "@iconify/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * A design-template picker with a real thumbnail per option — `Combobox`
 * (components/ui/combobox.tsx) only supports plain text options, so this
 * copies its Popover+Command skeleton with a custom CommandItem instead of
 * reusing it directly.
 */
export function DesignTemplatePicker({
  templates,
  value,
  onValueChange,
  disabled,
}: {
  templates: DesignTemplateRow[];
  value: string | null;
  onValueChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = templates.find((template) => template.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected ? (
              <>
                <img src={selected.preview_image_url} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />
                <span className="truncate">{selected.name}</span>
              </>
            ) : (
              <span className="text-muted-foreground">No design template</span>
            )}
          </span>
          <Icon icon="tabler:selector" className="ml-2 h-4 w-4 shrink-0 text-muted-foreground opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          <CommandInput placeholder="Search templates…" />
          <CommandList>
            <CommandEmpty>No design templates yet.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__none__"
                onSelect={() => {
                  onValueChange(null);
                  setOpen(false);
                }}
              >
                <Icon
                  icon="tabler:check"
                  className={cn("mr-2 h-4 w-4 shrink-0 text-primary", value === null ? "opacity-100" : "opacity-0")}
                />
                <span className="text-muted-foreground">No design template</span>
              </CommandItem>
              {templates.map((template) => (
                <CommandItem
                  key={template.id}
                  value={template.name}
                  onSelect={() => {
                    onValueChange(template.id);
                    setOpen(false);
                  }}
                >
                  <Icon
                    icon="tabler:check"
                    className={cn(
                      "mr-2 h-4 w-4 shrink-0 text-primary",
                      value === template.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <img src={template.preview_image_url} alt="" className="mr-2 h-8 w-8 shrink-0 rounded object-cover" />
                  <span className="truncate">{template.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
