import { FC } from "react";
import { VisuallyHidden } from "@react-aria/visually-hidden";
import { SwitchProps, useSwitch } from "@heroui/switch";
import clsx from "clsx";
import { Button, cn } from "@heroui/react";
import { useTheme } from "next-themes";

import { SunFilledIcon, MoonFilledIcon } from "@/components/Icons.tsx";

export interface ThemeSwitchProps {
  className?: string;
  classNames?: SwitchProps["classNames"];
  isCollapsed?: boolean;
  onToggle?: (theme: string) => void;
}

export const ThemeSwitch: FC<ThemeSwitchProps> = ({
  className,
  classNames,
  isCollapsed,
  onToggle,
}) => {
  const { theme, setTheme } = useTheme();

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";

    setTheme(newTheme);
    onToggle && onToggle(newTheme);
  };

  const { Component, isSelected, getBaseProps, getInputProps } = useSwitch({
    isSelected: theme === "light",
    "aria-label": `Switch to ${theme === "light" ? "dark" : "light"} mode`,
    onChange: toggleTheme,
  });

  return (
    <Component
      {...getBaseProps({
        className: clsx(
          "px-px transition-opacity hover:opacity-80 cursor-pointer w-full",
          className,
          classNames?.base,
        ),
      })}
    >
      <VisuallyHidden>
        <input {...getInputProps()} />
      </VisuallyHidden>
      <div className={"w-60"}>
        {!isSelected ? (
          <Button
            aria-label="日间模式"
            className={cn(
              "justify-start text-default-500 data-[hover=true]:text-foreground w-full",
              {
                "justify-center": isCollapsed,
              },
            )}
            isIconOnly={isCollapsed}
            startContent={
              isCollapsed ? null : (
                <SunFilledIcon
                  size={24}
                  onClick={(e) => {
                    e.preventDefault();
                  }}
                />
              )
            }
            variant="light"
            onPress={toggleTheme}
          >
            {isCollapsed ? (
              <SunFilledIcon
                size={24}
                onClick={(e) => {
                  e.preventDefault();
                }}
              />
            ) : (
              "日间模式"
            )}
          </Button>
        ) : (
          <Button
            aria-label="夜间模式"
            className={cn(
              "justify-start text-default-500 data-[hover=true]:text-foreground w-full",
              {
                "justify-center": isCollapsed,
              },
            )}
            isIconOnly={isCollapsed}
            startContent={
              isCollapsed ? null : (
                <MoonFilledIcon
                  size={24}
                  onClick={(e) => {
                    e.preventDefault();
                  }}
                />
              )
            }
            variant="light"
            onPress={toggleTheme}
          >
            {isCollapsed ? (
              <MoonFilledIcon
                size={24}
                onClick={(e) => {
                  e.preventDefault();
                }}
              />
            ) : (
              "夜间模式"
            )}
          </Button>
        )}
      </div>
    </Component>
  );
};
