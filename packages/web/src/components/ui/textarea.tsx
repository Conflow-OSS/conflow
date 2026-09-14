import * as React from "react"

import { cn } from "@/lib/utils"
import { useTheme } from "@/lib/theme"

import { BorderBeam } from "./border-beam"
import { formFieldBase, formFieldMultiLine } from "./_shared"

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  beam?: boolean
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, beam = true, ...props }, ref) => {
    const { theme } = useTheme()
    const textarea = (
      <textarea
        ref={ref}
        className={cn(formFieldBase, formFieldMultiLine, className)}
        {...props}
      />
    )

    if (!beam) return textarea

    return (
      <BorderBeam size="md" colorVariant="colorful" theme={theme} className="block w-full">
        {textarea}
      </BorderBeam>
    )
  },
)
Textarea.displayName = "Textarea"

export { Textarea }
