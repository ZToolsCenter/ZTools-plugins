import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LayoutGrid, Info } from "lucide-react";
import * as Copy from "../welcomeCopy";

interface TabsShowcaseProps {
  selectedTab: string;
  setSelectedTab: (tab: string) => void;
}

export function TabsShowcase({ selectedTab, setSelectedTab }: TabsShowcaseProps) {
  return (
    <Card className="shadow-lg border-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayoutGrid className="h-5 w-5 text-orange-500" />
          {Copy.TABS_CARD_TITLE}
        </CardTitle>
        <CardDescription>{Copy.TABS_CARD_DESC}</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={selectedTab} onValueChange={setSelectedTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="account">账户</TabsTrigger>
            <TabsTrigger value="settings">设置</TabsTrigger>
            <TabsTrigger value="about">关于</TabsTrigger>
          </TabsList>
          <TabsContent value="account" className="space-y-4">
            <div className="space-y-2">
              <Label>账户名称</Label>
              <Input defaultValue="Goose Note User" />
            </div>
            <div className="space-y-2">
              <Label>邮箱</Label>
              <Input type="email" defaultValue="user@goosenote.com" />
            </div>
            <Button>保存更改</Button>
          </TabsContent>
          <TabsContent value="settings" className="space-y-4">
            <p className="text-sm text-muted-foreground">在这里配置应用设置</p>
            <div className="space-y-2">
              <Label>主题颜色</Label>
              <div className="flex gap-2">
                <div className="h-8 w-8 rounded-full bg-blue-500 cursor-pointer border-2 border-offset-2 border-blue-500" />
                <div className="h-8 w-8 rounded-full bg-green-500 cursor-pointer" />
                <div className="h-8 w-8 rounded-full bg-purple-500 cursor-pointer" />
                <div className="h-8 w-8 rounded-full bg-orange-500 cursor-pointer" />
              </div>
            </div>
          </TabsContent>
          <TabsContent value="about" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {Copy.TAB_ABOUT_DESC}
            </p>
            <div className="flex items-center gap-2 text-sm">
              <Info className="h-4 w-4" />
              <span>版本: {Copy.VERSION}</span>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
