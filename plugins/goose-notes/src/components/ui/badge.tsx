import { cva, type VariantProps } from "class-variance-authority";
import { Chip as HeroChip } from "@heroui/react";

/**
 * 外壳基础控件：内部改为基于 @heroui/react 的 Chip.Root（文本标签语义）。
 * 注意：HeroUI 的 Badge 是“通知红点”语义，与本组件的文本标签不符，故用 Chip。
 * 业务契约零改动：仍导出 Badge + badgeVariants，variant 取值集合不变，
 * Chip.Root 默认渲染 <span>，className/HTML span 属性照常透传。
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({
  className,
  variant,
  children,
  // HeroUI Chip.Root 把 color/size/variant 收窄为自有联合类型，与 HTMLSpan 的
  // 宽松 color 属性冲突；本组件不透传这些视觉 prop（全部由 badgeVariants 上色），
  // 故剔除后再把剩余的原生 span 属性透传。
  color: _color,
  ...props
}: BadgeProps) {
  return (
    <HeroChip.Root
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      {children}
    </HeroChip.Root>
  );
}

export { Badge, badgeVariants };
