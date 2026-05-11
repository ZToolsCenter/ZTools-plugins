import React from "react";
import { cn } from "@heroui/react";

interface DividerClassNames {
  base?: string;
  line?: string;
  title?: string;
}

interface DividerProps {
  title?: string;
  className?: string;
  classNames?: DividerClassNames;
  lineColor?: string;
  titleColor?: string;
  thickness?: number;
}

const Divider: React.FC<DividerProps> = ({
  title,
  classNames = {},
  thickness = 1,
}) => {
  const {
    base: baseClass = "",
    line: lineClass = "",
    title: titleClass = "",
  } = classNames;

  return (
    <div className={cn("flex items-center w-full my-4", baseClass)}>
      <div
        className={cn(`flex-grow border-t`, lineClass)}
        style={{ borderTopWidth: `${thickness}px` }}
      />

      {title && (
        <div
          className={cn(
            `px-4 text-base font-bold text-default-700`,
            titleClass,
          )}
        >
          {title}
        </div>
      )}

      <div
        className={cn(`flex-grow border-t`, lineClass)}
        style={{ borderTopWidth: `${thickness}px` }}
      />
    </div>
  );
};

export default Divider;
