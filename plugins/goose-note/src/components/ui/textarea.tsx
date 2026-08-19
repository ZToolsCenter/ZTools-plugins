import * as React from "react"
import { cn } from "@/lib/utils"
import { TextArea as HeroTextArea } from "@heroui/react"

/**
 * 外壳基础控件：内部改为基于 @heroui/react 的 TextArea（React Aria 的受控原生 textarea）。
 * 业务契约零改动：原生 <textarea> props（id/placeholder/value/onChange(e)/rows/ref…），
 * className 还原原 shadcn 视觉。
 */
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <HeroTextArea
      data-slot="textarea"
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
