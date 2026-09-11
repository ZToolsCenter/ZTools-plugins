import * as React from"react"
import { Input as InputPrimitive } from"@base-ui/react/input"

import { cn } from"@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
 function Input({ className, type, ...props }, ref) {
 return (
 <InputPrimitive
 ref={ref}
 type={type}
 data-slot="input"
 className={cn(
"w-full min-w-0 rounded-cell border bg-input px-3.5 py-2.5 text-[13px] text-fg transition-colors outline-none hover:border-border-strong focus:border-accent placeholder:text-fg-faint disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-border-soft disabled:bg-surface-hover disabled:text-fg-faint disabled:opacity-100 aria-invalid:border-destructive file:inline-flex file:border-0 file:bg-transparent file:text-sm file:font-medium",
 className
 )}
 {...props}
 />
 )
})

export { Input }
