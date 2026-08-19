import { defineRegistry } from "@json-render/react";
import { jsonRenderCatalog } from "./json-render-catalog";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

/**
 * 将 Catalog 中的组件名映射到实际的 React 组件实现。
 * 使用项目现有的 shadcn/ui 组件。
 */

export const { registry } = defineRegistry(jsonRenderCatalog, {
  components: {
    Card: ({ props, children }) => (
      <Card className={props.className}>{children}</Card>
    ),
    CardHeader: ({ props, children }) => (
      <CardHeader className={props.className}>{children}</CardHeader>
    ),
    CardTitle: ({ props }) => (
      <CardTitle className={props.className}>{props.text}</CardTitle>
    ),
    CardDescription: ({ props }) => (
      <CardDescription className={props.className}>{props.text}</CardDescription>
    ),
    CardContent: ({ props, children }) => (
      <CardContent className={props.className}>{children}</CardContent>
    ),
    CardFooter: ({ props, children }) => (
      <CardFooter className={props.className}>{children}</CardFooter>
    ),
    Button: ({ props, emit }) => (
      <Button
        variant={props.variant}
        size={props.size}
        disabled={props.disabled}
        className={props.className}
        onClick={() => emit("press")}
      >
        {props.label}
      </Button>
    ),
    Input: ({ props, bindings }) => {
      const bindingPath = bindings?.value;
      return (
        <Input
          type={props.type}
          placeholder={props.placeholder}
          defaultValue={props.value}
          disabled={props.disabled}
          className={props.className}
          onChange={(e) => {
            // json-render 的双向绑定会在 bindings 中提供路径
            // 这里简单处理：如果有 binding，可以触发 action
            if (bindingPath) {
              // 状态更新由 json-render 的 ActionProvider 处理
            }
          }}
        />
      );
    },
    Label: ({ props }) => (
      <Label htmlFor={props.htmlFor} className={props.className}>
        {props.text}
      </Label>
    ),
    Separator: ({ props }) => (
      <Separator className={props.className} />
    ),
    Text: ({ props }) => {
      const sizeMap: Record<string, string> = {
        xs: "text-xs",
        sm: "text-sm",
        base: "text-base",
        lg: "text-lg",
        xl: "text-xl",
      };
      const colorMap: Record<string, string> = {
        default: "text-foreground",
        muted: "text-muted-foreground",
        primary: "text-primary",
        secondary: "text-secondary-foreground",
        destructive: "text-destructive",
      };
      return (
        <span
          className={cn(
            sizeMap[props.size ?? "base"],
            colorMap[props.color ?? "default"],
            props.className
          )}
        >
          {props.content}
        </span>
      );
    },
    FlexRow: ({ props, children }) => (
      <div
        className={cn(
          "flex flex-row",
          props.gap && `gap-${props.gap}`,
          props.align && `items-${props.align}`,
          props.justify && `justify-${props.justify}`,
          props.className
        )}
      >
        {children}
      </div>
    ),
    FlexCol: ({ props, children }) => (
      <div
        className={cn(
          "flex flex-col",
          props.gap && `gap-${props.gap}`,
          props.align && `items-${props.align}`,
          props.className
        )}
      >
        {children}
      </div>
    ),
    Grid: ({ props, children }) => (
      <div
        className={cn(
          "grid",
          props.cols === "2" && "grid-cols-2",
          props.cols === "3" && "grid-cols-3",
          props.cols === "4" && "grid-cols-4",
          props.gap && `gap-${props.gap}`,
          props.className
        )}
      >
        {children}
      </div>
    ),
    DataTable: ({ props }) => (
      <Table className={props.className}>
        {props.caption && <TableCaption>{props.caption}</TableCaption>}
        <TableHeader>
          <TableRow>
            {props.columns.map((col, i) => (
              <TableHead key={i}>{col}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.rows.map((row, ri) => (
            <TableRow key={ri}>
              {row.map((cell, ci) => (
                <TableCell key={ci}>{cell}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    ),
    Progress: ({ props }) => (
      <div className={cn("flex flex-col gap-1", props.className)}>
        {props.label && (
          <span className="text-xs text-muted-foreground">{props.label}</span>
        )}
        <Progress value={props.value} />
      </div>
    ),
    Badge: ({ props }) => (
      <Badge variant={props.variant} className={props.className}>
        {props.text}
      </Badge>
    ),
    Stat: ({ props }) => {
      const deltaColor =
        props.trend === "up"
          ? "text-[var(--goose-color-success)]"
          : props.trend === "down"
            ? "text-[var(--goose-color-danger)]"
            : "text-muted-foreground";
      return (
        <div className={cn("flex flex-col gap-0.5", props.className)}>
          <span className="text-xs text-muted-foreground">{props.label}</span>
          <span className="text-2xl font-semibold">{props.value}</span>
          {props.delta && (
            <span className={cn("text-xs", deltaColor)}>{props.delta}</span>
          )}
        </div>
      );
    },
  },
});
