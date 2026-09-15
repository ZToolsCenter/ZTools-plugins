import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  MessageSquare,
  CirclePlus,
  Sidebar,
  Layers,
  Popcorn,
  Menu,
  User,
  CreditCard,
  Settings,
  LogOut,
  HelpCircle,
} from "lucide-react";
import * as Copy from "../welcomeCopy";

export function OverlayShowcase() {
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card className="shadow-lg border-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-red-500" />
            {Copy.DIALOG_CARD_TITLE}
          </CardTitle>
          <CardDescription>{Copy.DIALOG_CARD_DESC}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">
                <CirclePlus className="mr-2 h-4 w-4" />
                打开对话框
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{Copy.DIALOG_CONFIRM_TITLE}</DialogTitle>
                <DialogDescription>
                  {Copy.DIALOG_CONFIRM_DESC}
                </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <p className="text-sm text-muted-foreground">
                  {Copy.DIALOG_CONFIRM_BODY}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline">取消</Button>
                <Button>确认</Button>
              </div>
            </DialogContent>
          </Dialog>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">
                <Sidebar className="mr-2 h-4 w-4" />
                打开侧边栏
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>{Copy.SHEET_TITLE}</SheetTitle>
                <SheetDescription>
                  {Copy.SHEET_DESC}
                </SheetDescription>
              </SheetHeader>
              <div className="py-4 space-y-4">
                <p className="text-sm text-muted-foreground">
                  {Copy.SHEET_BODY}
                </p>
                <Separator />
                <div className="space-y-2">
                  <Label>选项 1</Label>
                  <Input placeholder="输入内容..." />
                </div>
                <div className="space-y-2">
                  <Label>选项 2</Label>
                  <Textarea placeholder="输入描述..." rows={3} />
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </CardContent>
      </Card>

      <Card className="shadow-lg border-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-cyan-500" />
            {Copy.POPOVER_CARD_TITLE}
          </CardTitle>
          <CardDescription>{Copy.POPOVER_CARD_DESC}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">
                <Popcorn className="mr-2 h-4 w-4" />
                打开弹出框
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80">
              <div className="grid gap-4">
                <h4 className="font-medium">弹出框内容</h4>
                <p className="text-sm text-muted-foreground">
                  {Copy.POPOVER_BODY}
                </p>
                <div className="space-y-2">
                  <Label>快速输入</Label>
                  <Input placeholder="快速输入..." />
                </div>
                <Button size="sm" className="w-full">
                  确认
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Menu className="mr-2 h-4 w-4" />
                下拉菜单
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuLabel>我的账户</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <User className="mr-2 h-4 w-4" />
                <span>个人资料</span>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <CreditCard className="mr-2 h-4 w-4" />
                <span>账单</span>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Settings className="mr-2 h-4 w-4" />
                <span>设置</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-red-600">
                <LogOut className="mr-2 h-4 w-4" />
                <span>退出登录</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline">
                  <HelpCircle className="mr-2 h-4 w-4" />
                  带提示的按钮
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{Copy.TOOLTIP_TEXT}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardContent>
      </Card>
    </div>
  );
}
