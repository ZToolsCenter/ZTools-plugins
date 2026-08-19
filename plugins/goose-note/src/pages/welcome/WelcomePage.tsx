import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, ArrowRight, Heart } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { useNavigate } from "react-router-dom";
import { WelcomeShortcutsCard } from "./WelcomeShortcutsCard";
import { ButtonShowcase } from "./components/ButtonShowcase";
import { ToggleShowcase } from "./components/ToggleShowcase";
import { TabsShowcase } from "./components/TabsShowcase";
import { OverlayShowcase } from "./components/OverlayShowcase";
import { FeaturesShowcase } from "./components/FeaturesShowcase";
import * as Copy from "./welcomeCopy";

export function WelcomePage() {
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState("");
  const [textareaValue, setTextareaValue] = useState("");
  const [switchStates, setSwitchStates] = useState({
    notifications: true,
    autoSave: false,
    darkMode: true,
  });
  const [togglePressed, setTogglePressed] = useState(false);
  const [selectedTab, setSelectedTab] = useState("account");

  const handleButtonClick = () => {
    toast.success(Copy.TOAST_BUTTON_SUCCESS, {
      description: Copy.TOAST_BUTTON_SUCCESS_DESC,
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTextareaValue(e.target.value);
  };

  const handleSwitchChange = (key: string, checked: boolean) => {
    setSwitchStates((prev) => ({ ...prev, [key]: checked }));
    toast.info(Copy.TOAST_SWITCH_TOGGLED(key, checked));
  };

  const navigateToSubPage = () => {
    navigate("/welcome/sub-page");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <ScrollArea className="h-screen">
        <div className="max-w-7xl mx-auto p-8 space-y-8">
          {/* 头部区域 */}
          <div className="text-center space-y-4 py-12">
            <div className="inline-block p-4 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl shadow-lg">
              <Sparkles className="h-16 w-16 text-white" />
            </div>
            <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              {Copy.APP_TITLE}
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              {Copy.APP_DESCRIPTION}
            </p>
            <div className="flex gap-4 justify-center pt-4">
              <Button size="lg" onClick={navigateToSubPage} className="shadow-lg">
                <ArrowRight className="mr-2 h-5 w-5" />
                {Copy.BTN_GO_SUBPAGE}
              </Button>
              <Button size="lg" variant="outline" onClick={handleButtonClick}>
                <Heart className="mr-2 h-5 w-5" />
                {Copy.BTN_LIKE}
              </Button>
            </div>
          </div>

          <Separator className="my-8" />

          {/* 按钮组件展示 */}
          <ButtonShowcase handleButtonClick={handleButtonClick} />

          {/* 输入与开关组件展示 */}
          <div className="grid md:grid-cols-2 gap-6">
            <WelcomeShortcutsCard
              inputValue={inputValue}
              textareaValue={textareaValue}
              onInputChange={handleInputChange}
              onTextareaChange={handleTextareaChange}
            />

            <ToggleShowcase
              switchStates={switchStates}
              handleSwitchChange={handleSwitchChange}
              togglePressed={togglePressed}
              setTogglePressed={setTogglePressed}
            />
          </div>

          {/* 选项卡组件展示 */}
          <TabsShowcase selectedTab={selectedTab} setSelectedTab={setSelectedTab} />

          {/* 弹出层组件展示 */}
          <OverlayShowcase />

          {/* 交互式卡片网格 */}
          <FeaturesShowcase />

          {/* 底部提示 */}
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">
              {Copy.FOOTER_TEXT}
            </p>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
