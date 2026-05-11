import "@/styles/globals.css";
import {
  Button,
  cn,
  Image,
  Spacer,
  Tooltip,
  useDisclosure,
} from "@heroui/react";
import { Icon } from "@iconify/react";
import React, { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import SidebarDrawer from "@/components/sidebar/SidebarDrawer.tsx";
import Sidebar from "@/components/sidebar/Sidebar.tsx";
import { items, SidebarKeys } from "@/components/sidebar/Items.tsx";
import { ThemeSwitch } from "@/components/button/ThemeSwitch.tsx";
import { useSidebarStore } from "@/store/useSidebarStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTabStore } from "@/store/useTabStore";
import { getFontSizeConfig } from "@/styles/fontSize";

function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sidebarStore = useSidebarStore();
  const { initTab } = useTabStore();
  const navigate = useNavigate();
  const location = useLocation();

  const { isOpen, onOpenChange } = useDisclosure();
  const [isCollapsed, setIsCollapsed] = React.useState(true);

  // 菜单项点击事件
  const handleSidebarSelect = (
    key: string | React.SyntheticEvent<HTMLUListElement>,
  ) => {
    let isContinue = false;

    items.forEach((item) => {
      if (key == item.key && item.route) {
        isContinue = true;
        navigate(item.route);
      }
    });

    if (isContinue) {
      return;
    }

    if (location.pathname !== "/") {
      navigate("/");
    }
    sidebarStore.updateClickSwitchKey(key as SidebarKeys);
  };

  const onToggle = React.useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  useEffect(() => {
    const init = async () => {
      // 先同步设置数据到 store（如果有的话）
      await useSettingsStore.getState().syncSettingsStore();

      // 获取同步后的设置状态
      const editDataSaveLocal = useSettingsStore.getState().editDataSaveLocal;
      const expandSidebar = useSettingsStore.getState().expandSidebar;

      if (editDataSaveLocal) {
        // 如果启用了本地存储，同步侧边栏状态
        setIsCollapsed(!expandSidebar);
        await sidebarStore.syncSidebarStore();
      } else {
        // 如果未启用本地存储，初始化默认标签页
        initTab();
      }
    };

    init();
  }, []);

  return (
    <div className="relative flex h-dvh w-full border-t border-default-200">
      {/* Sidebar */}
      <SidebarDrawer
        className={cn("shrink-0", {
          "w-[56px]": isCollapsed,
          "w-[170px]": !isCollapsed,
        })}
        hideCloseButton={true}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
      >
        <div
          className={cn(
            "will-change relative flex h-full flex-col bg-default-100 py-4 px-2 transition-width",
            {
              "items-center px-[6px] py-4": isCollapsed,
            },
          )}
          style={{ width: isCollapsed ? 56 : 170 }}
        >
          <div
            className={cn(
              "w-full flex items-center justify-between gap-3 pl-4 pr-4",
              {
                "justify-center gap-0 px-0": isCollapsed,
              },
            )}
          >
            <div
              className={cn("flex items-center justify-center rounded-full")}
            >
              <Image className="h-9 w-9 rounded-fulll" src="./logo.png" />
            </div>

            <div className={cn("flex-end flex", { hidden: isCollapsed })}>
              <Icon
                className="cursor-pointer dark:text-primary-foreground/60 [&>g]:stroke-[1px]"
                icon="solar:round-alt-arrow-left-line-duotone"
                width={28}
                onClick={onToggle}
              />
            </div>
          </div>
          <Spacer y={4} />

          {/* 菜单项*/}
          <Sidebar
            currentKey={useSidebarStore().activeKey}
            iconClassName="group-data-[selected=true]:text-default-50"
            isCompact={isCollapsed}
            itemClasses={{
              base: "px-3 rounded-large data-[selected=true]:!bg-default-700",
              title: "group-data-[selected=true]:text-default-50",
            }}
            items={items}
            onSelect={handleSidebarSelect}
          />

          <Spacer y={8} />

          <div
            className={cn("mt-auto flex flex-col", {
              "items-center": isCollapsed,
            })}
          >
            {isCollapsed && (
              <Tooltip
                content="展开菜单"
                isDisabled={!isCollapsed}
                placement="right"
              >
                <Button
                  isIconOnly
                  aria-label="展开菜单"
                  className="flex h-10 w-10 text-default-600"
                  size="sm"
                  variant="light"
                >
                  <Icon
                    className="cursor-pointer dark:text-primary-foreground/60 [&>g]:stroke-[1px]"
                    height={24}
                    icon="solar:round-alt-arrow-right-line-duotone"
                    width={24}
                    onClick={onToggle}
                  />
                </Button>
              </Tooltip>
            )}

            {/* 主题切换 */}
            <ThemeSwitch isCollapsed={isCollapsed} />
            <Tooltip
              content="更多设置"
              isDisabled={!isCollapsed}
              placement="right"
            >
              <Button
                aria-label="更多设置"
                className={cn(
                  "justify-start text-default-500 data-[hover=true]:text-foreground",
                  {
                    "justify-center": isCollapsed,
                  },
                )}
                isIconOnly={isCollapsed}
                startContent={
                  isCollapsed ? null : (
                    <Icon
                      className="flex-none rotate-180 text-default-500"
                      icon="solar:settings-outline"
                      width={24}
                      onClick={(e) => e.preventDefault()}
                    />
                  )
                }
                variant="light"
                onPress={() => {
                  navigate("./settings");
                }}
              >
                {isCollapsed ? (
                  <Icon
                    className="rotate-180 text-default-500"
                    icon="solar:settings-outline"
                    width={24}
                  />
                ) : (
                  "更多设置"
                )}
              </Button>
            </Tooltip>
          </div>
        </div>
      </SidebarDrawer>

      {/*  Settings Content */}
      <div className="flex-1 overflow-hidden min-w-16">{children}</div>
    </div>
  );
}

// 根组件外层包装字体大小样式
function FontSizeLayout({ children }: { children: React.ReactNode }) {
  const { fontSize } = useSettingsStore();
  const fontSizeConfig = getFontSizeConfig(fontSize);
  return (
    <div
      style={{
        // 应用字体大小到整个布局
        fontSize: fontSizeConfig.base,
        lineHeight: fontSizeConfig.lineHeight,
      }}
      className="font-size-text"
    >
      {children}
    </div>
  );
}

export default function DefaultLayout(props: { children: React.ReactNode }) {
  return (
    <FontSizeLayout>
      <RootLayout {...props} />
    </FontSizeLayout>
  );
}
