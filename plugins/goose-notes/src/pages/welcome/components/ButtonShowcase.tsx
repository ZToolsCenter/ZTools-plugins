import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MousePointer2, Star, Download, GitBranch } from "lucide-react";
import * as Copy from "../welcomeCopy";

interface ButtonShowcaseProps {
  handleButtonClick: () => void;
}

export function ButtonShowcase({ handleButtonClick }: ButtonShowcaseProps) {
  return (
    <Card className="shadow-lg border-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MousePointer2 className="h-5 w-5 text-blue-500" />
          {Copy.BUTTON_CARD_TITLE}
        </CardTitle>
        <CardDescription>{Copy.BUTTON_CARD_DESC}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Button onClick={handleButtonClick}>默认按钮</Button>
          <Button variant="secondary">次要按钮</Button>
          <Button variant="destructive">危险按钮</Button>
          <Button variant="outline">轮廓按钮</Button>
          <Button variant="ghost">幽灵按钮</Button>
          <Button variant="link">链接按钮</Button>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button size="sm">小按钮</Button>
          <Button size="default">默认大小</Button>
          <Button size="lg">大按钮</Button>
          <Button size="icon">
            <Star className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button disabled>禁用按钮</Button>
          <Button>
            <Download className="mr-2 h-4 w-4" />
            带图标
          </Button>
          <Button variant="outline">
            <GitBranch className="mr-2 h-4 w-4" />
            GitHub
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
