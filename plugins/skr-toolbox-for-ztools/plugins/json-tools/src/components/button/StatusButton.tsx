import React, { forwardRef } from "react";
import { Button, cn } from "@heroui/react";
import { Icon } from "@iconify/react";

export enum IconStatus {
  Default = "default",
  Success = "success",
  Loading = "loading",
  Error = "error",
}

export interface StatusButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  text: string;
  successText?: string;
  status: IconStatus;
  icon: string;
  iconSize?: number;
  className?: string;
  onClick: () => void;
  endContent?: React.ReactNode;
}

const StatusButton = forwardRef<HTMLButtonElement, StatusButtonProps>(
  (
    {
      text,
      successText,
      status,
      icon,
      iconSize = 16,
      onClick,
      endContent,
      className,
    },
    // @ts-ignore
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ref,
  ) => {
    const renderIcon = () => {
      switch (status) {
        case IconStatus.Success:
          return <Icon icon="icon-park-solid:success" width={iconSize} />;
        case IconStatus.Error:
          return <Icon icon="humbleicons:times" width={iconSize} />;
        default:
          return <Icon icon={icon} width={iconSize} />;
      }
    };

    return (
      <Button
        className={cn(
          "min-w-0 px-1.5 gap-1 text-default-600 h-7 text-xs",
          {
            "text-green-500": status === IconStatus.Success,
            "text-red-500": status === IconStatus.Error,
          },
          className,
        )}
        endContent={endContent}
        startContent={renderIcon()}
        variant="light"
        onPress={onClick}
      >
        {status === IconStatus.Success && successText ? successText : text}
      </Button>
    );
  },
);

StatusButton.displayName = "StatusButton";
export default StatusButton;
