import React from "react";

import { useAdaptiveLayout } from "@/hooks/useAdaptiveLayout.ts";

/**
 * 自适应布局高阶组件
 * 为包装的组件提供自适应布局支持
 */
export function withAdaptiveLayout<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options: {
    enableScaling?: boolean;
    scaleContent?: boolean;
    preserveAspectRatio?: boolean;
  } = {},
) {
  const {
    enableScaling = true,
    scaleContent = false,
    preserveAspectRatio = true,
  } = options;

  return function WithAdaptiveLayout(props: P) {
    const { scaleFactor, getContainerStyles, getComponentSpacingStyles } =
      useAdaptiveLayout();

    const containerStyles: React.CSSProperties = {
      ...getContainerStyles(),
      ...(enableScaling && scaleContent
        ? {
            transform: `scale(${scaleFactor})`,
            transformOrigin: "top left",
            width: preserveAspectRatio ? `${100 / scaleFactor}%` : "100%",
            height: preserveAspectRatio ? `${100 / scaleFactor}%` : "auto",
          }
        : {}),
    };

    const spacingStyles = getComponentSpacingStyles();

    return (
      <div className="adaptive-layout-wrapper" style={containerStyles}>
        <div className="adaptive-layout-content" style={spacingStyles}>
          <WrappedComponent {...props} />
        </div>
      </div>
    );
  };
}

/**
 * 自适应布局容器组件
 */
interface AdaptiveLayoutContainerProps {
  children: React.ReactNode;
  className?: string;
  scaling?: "none" | "content" | "spacing" | "both";
  preserveAspectRatio?: boolean;
  style?: React.CSSProperties;
}

export const AdaptiveLayoutContainer: React.FC<
  AdaptiveLayoutContainerProps
> = ({
  children,
  className = "",
  scaling = "spacing",
  preserveAspectRatio = true,
  style = {},
}) => {
  const { scaleFactor, getContainerStyles, getComponentSpacingStyles } =
    useAdaptiveLayout();

  const getStyles = (): React.CSSProperties => {
    const baseStyles = { ...getContainerStyles(), ...style };

    switch (scaling) {
      case "content":
        return {
          ...baseStyles,
          transform: `scale(${scaleFactor})`,
          transformOrigin: "top left",
          width: preserveAspectRatio ? `${100 / scaleFactor}%` : "100%",
          height: preserveAspectRatio ? `${100 / scaleFactor}%` : "auto",
        };
      case "spacing":
        return {
          ...baseStyles,
          ...getComponentSpacingStyles(),
        };
      case "both":
        return {
          ...baseStyles,
          transform: `scale(${scaleFactor})`,
          transformOrigin: "top left",
          width: preserveAspectRatio ? `${100 / scaleFactor}%` : "100%",
          height: preserveAspectRatio ? `${100 / scaleFactor}%` : "auto",
          ...getComponentSpacingStyles(),
        };
      case "none":
      default:
        return baseStyles;
    }
  };

  return (
    <div
      className={`adaptive-layout-container ${className}`.trim()}
      style={getStyles()}
    >
      {children}
    </div>
  );
};

/**
 * 自适应间距组件
 */
interface AdaptiveSpacingProps {
  children: React.ReactNode;
  size?:
    | "xs"
    | "sm"
    | "md"
    | "lg"
    | "xl"
    | "2xl"
    | "3xl"
    | "4xl"
    | "5xl"
    | "6xl";
  type?: "padding" | "margin" | "gap" | "all";
  className?: string;
}

export const AdaptiveSpacing: React.FC<AdaptiveSpacingProps> = ({
  children,
  size = "md",
  type = "all",
  className = "",
}) => {
  const { getResponsiveClass } = useAdaptiveLayout();

  const getClassNames = (): string => {
    const baseClass = getResponsiveClass("spacing", size);

    switch (type) {
      case "padding":
        return `p-${size} ${className}`.trim();
      case "margin":
        return `m-${size} ${className}`.trim();
      case "gap":
        return `gap-${size} ${className}`.trim();
      case "all":
        return `${baseClass} ${className}`.trim();
      default:
        return `${baseClass} ${className}`.trim();
    }
  };

  return <div className={getClassNames()}>{children}</div>;
};

/**
 * 自适应尺寸组件
 */
interface AdaptiveSizeProps {
  width?: number;
  height?: number;
  children: React.ReactNode;
  className?: string;
}

export const AdaptiveSize: React.FC<AdaptiveSizeProps> = ({
  width,
  height,
  children,
  className = "",
}) => {
  const { getScaledSize } = useAdaptiveLayout();

  const styles: React.CSSProperties = {};

  if (width) {
    styles.width = getScaledSize(width);
  }
  if (height) {
    styles.height = getScaledSize(height);
  }

  return (
    <div className={`adaptive-size ${className}`.trim()} style={styles}>
      {children}
    </div>
  );
};
