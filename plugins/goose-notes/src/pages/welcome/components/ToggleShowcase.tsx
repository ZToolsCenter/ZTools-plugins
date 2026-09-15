import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import { Separator } from "@/components/ui/separator";
import { ToggleLeft, Bold, Italic, Underline } from "lucide-react";
import * as Copy from "../welcomeCopy";

interface ToggleShowcaseProps {
  switchStates: {
    notifications: boolean;
    autoSave: boolean;
    darkMode: boolean;
  };
  handleSwitchChange: (key: string, checked: boolean) => void;
  togglePressed: boolean;
  setTogglePressed: (pressed: boolean) => void;
}

export function ToggleShowcase({
  switchStates,
  handleSwitchChange,
  togglePressed,
  setTogglePressed,
}: ToggleShowcaseProps) {
  return (
    <Card className="shadow-lg border-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ToggleLeft className="h-5 w-5 text-purple-500" />
          {Copy.TOGGLE_CARD_TITLE}
        </CardTitle>
        <CardDescription>{Copy.TOGGLE_CARD_DESC}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <Label htmlFor="notifications">启用通知</Label>
          <Switch
            id="notifications"
            checked={switchStates.notifications}
            onCheckedChange={(checked) => handleSwitchChange("notifications", checked)}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="autosave">自动保存</Label>
          <Switch
            id="autosave"
            checked={switchStates.autoSave}
            onCheckedChange={(checked) => handleSwitchChange("autoSave", checked)}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="darkmode">深色模式</Label>
          <Switch
            id="darkmode"
            checked={switchStates.darkMode}
            onCheckedChange={(checked) => handleSwitchChange("darkMode", checked)}
          />
        </div>
        <Separator />
        <div className="space-y-2">
          <Label>切换按钮</Label>
          <div className="flex gap-2">
            <Toggle
              pressed={togglePressed}
              onPressedChange={setTogglePressed}
              aria-label="Toggle bold"
            >
              <Bold className="h-4 w-4" />
            </Toggle>
            <Toggle
              pressed={false}
              aria-label="Toggle italic"
            >
              <Italic className="h-4 w-4" />
            </Toggle>
            <Toggle
              pressed={false}
              aria-label="Toggle underline"
            >
              <Underline className="h-4 w-4" />
            </Toggle>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
