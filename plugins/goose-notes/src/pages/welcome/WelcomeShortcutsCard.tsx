import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import * as LucideIcons from "lucide-react";
import { INPUT_CARD_TITLE, INPUT_CARD_DESC, INPUT_CHAR_COUNT } from "./welcomeCopy";

interface WelcomeShortcutsCardProps {
  inputValue: string;
  textareaValue: string;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onTextareaChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
}

export function WelcomeShortcutsCard({
  inputValue,
  textareaValue,
  onInputChange,
  onTextareaChange,
}: WelcomeShortcutsCardProps) {
  return (
    <Card className="shadow-lg border-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LucideIcons.Keyboard className="h-5 w-5 text-green-500" />
          {INPUT_CARD_TITLE}
        </CardTitle>
        <CardDescription>{INPUT_CARD_DESC}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="username">用户名</Label>
          <Input
            id="username"
            placeholder="请输入用户名"
            value={inputValue}
            onChange={onInputChange}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">邮箱</Label>
          <Input
            id="email"
            type="email"
            placeholder="example@email.com"
            disabled
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="message">留言</Label>
          <Textarea
            id="message"
            placeholder="请输入您的留言..."
            value={textareaValue}
            onChange={onTextareaChange}
            rows={4}
          />
        </div>
        <div className="text-sm text-muted-foreground">
          {INPUT_CHAR_COUNT(inputValue.length, textareaValue.length)}
        </div>
      </CardContent>
    </Card>
  );
}
