import React from "react";
import { Card, CardBody, CardHeader } from "@heroui/react";
import { Icon } from "@iconify/react";

import { useAdaptiveLayout } from "@/hooks/useAdaptiveLayout.ts";
import {
  AdaptiveLayoutContainer,
  AdaptiveSpacing,
  AdaptiveSize,
} from "@/components/AdaptiveLayout/AdaptiveLayoutComponents.tsx";

/**
 * 自适应布局演示组件
 * 展示不同字体大小下的布局缩放效果
 */
export const AdaptiveLayoutDemo: React.FC = () => {
  const { fontSize, scaleFactor, spacing, sizes, getResponsiveClass } =
    useAdaptiveLayout();

  return (
    <AdaptiveLayoutContainer className="adaptive-layout-demo" scaling="spacing">
      <div className="space-y-6">
        {/* 标题和说明 */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-default-900">
            自适应布局演示
          </h1>
          <p className="text-default-600">
            当前字体大小: {fontSize} | 缩放因子: {scaleFactor}x
          </p>
        </div>

        {/* 基本间距演示 */}
        <Card className="w-full">
          <CardHeader>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Icon icon="solar:spacing-vertical-bold" width={20} />
              间距缩放演示
            </h2>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <AdaptiveSpacing size="sm">
                <Card className="bg-primary/50">
                  <CardBody className="text-center">
                    <p className="font-medium">小间距</p>
                    <p className="text-sm text-default-600">
                      {spacing.sm.toFixed(1)}px
                    </p>
                  </CardBody>
                </Card>
              </AdaptiveSpacing>

              <AdaptiveSpacing size="md">
                <Card className="bg-secondary/50">
                  <CardBody className="text-center">
                    <p className="font-medium">中间距</p>
                    <p className="text-sm text-default-600">
                      {spacing.md.toFixed(1)}px
                    </p>
                  </CardBody>
                </Card>
              </AdaptiveSpacing>

              <AdaptiveSpacing size="lg">
                <Card className="bg-success/50">
                  <CardBody className="text-center">
                    <p className="font-medium">大间距</p>
                    <p className="text-sm text-default-600">
                      {spacing.lg.toFixed(1)}px
                    </p>
                  </CardBody>
                </Card>
              </AdaptiveSpacing>
            </div>
          </CardBody>
        </Card>

        {/* 组件尺寸演示 */}
        <Card className="w-full">
          <CardHeader>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Icon icon="solar:resize-bold" width={20} />
              组件尺寸演示
            </h2>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <AdaptiveSize height={80} width={120}>
                <Card className="bg-warning/50 h-full flex items-center justify-center">
                  <CardBody className="text-center p-2">
                    <Icon icon="solar:widget-1-bold" width={24} />
                    <p className="text-xs mt-1">小组件</p>
                  </CardBody>
                </Card>
              </AdaptiveSize>

              <AdaptiveSize height={100} width={160}>
                <Card className="bg-info/50 h-full flex items-center justify-center">
                  <CardBody className="text-center p-3">
                    <Icon icon="solar:widget-2-bold" width={32} />
                    <p className="text-sm mt-1">中组件</p>
                  </CardBody>
                </Card>
              </AdaptiveSize>

              <AdaptiveSize height={120} width={200}>
                <Card className="bg-danger/50 h-full flex items-center justify-center">
                  <CardBody className="text-center p-4">
                    <Icon icon="solar:widget-3-bold" width={40} />
                    <p className="text-base mt-1">大组件</p>
                  </CardBody>
                </Card>
              </AdaptiveSize>

              <AdaptiveSize height={140} width={240}>
                <Card className="bg-gradient-to-r from-purple-500 to-pink-500 h-full flex items-center justify-center">
                  <CardBody className="text-center p-4">
                    <Icon icon="solar:widget-4-bold" width={48} />
                    <p className="text-lg mt-1 font-medium">超大组件</p>
                  </CardBody>
                </Card>
              </AdaptiveSize>
            </div>
          </CardBody>
        </Card>

        {/* 布局网格演示 */}
        <Card className="w-full">
          <CardHeader>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Icon icon="solar:grid-1-bold" width={20} />
              布局网格演示
            </h2>
          </CardHeader>
          <CardBody>
            <div
              className={`grid grid-cols-2 md:grid-cols-4 gap-4 ${getResponsiveClass("gap", "md")}`}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((item) => (
                <Card key={item} className="bg-default-100">
                  <CardBody className="text-center p-3">
                    <div className="w-8 h-8 bg-primary rounded-full mx-auto mb-2 flex items-center justify-center">
                      <span className="text-white text-sm font-medium">
                        {item}
                      </span>
                    </div>
                    <p className="text-xs text-default-600">网格项 {item}</p>
                  </CardBody>
                </Card>
              ))}
            </div>
          </CardBody>
        </Card>

        {/* 圆角缩放演示 */}
        <Card className="w-full">
          <CardHeader>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Icon icon="solar:rounded-corner-bold" width={20} />
              圆角缩放演示
            </h2>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div
                className={`rounded-xs bg-gradient-to-r from-blue-500 to-cyan-500 p-4 text-white text-center`}
              >
                <p className="font-medium">小圆角</p>
                <p className="text-sm opacity-90">extra small</p>
              </div>

              <div
                className={`rounded-md bg-gradient-to-r from-green-500 to-emerald-500 p-4 text-white text-center`}
              >
                <p className="font-medium">中圆角</p>
                <p className="text-sm opacity-90">medium</p>
              </div>

              <div
                className={`rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 p-4 text-white text-center`}
              >
                <p className="font-medium">大圆角</p>
                <p className="text-sm opacity-90">extra large</p>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* 缩放比例参考 */}
        <Card className="w-full">
          <CardHeader>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Icon icon="solar:ruler-bold" width={20} />
              当前缩放比例参考
            </h2>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="text-center p-3 bg-default-100 rounded-lg">
                <p className="font-medium text-default-900">字体大小</p>
                <p className="text-default-600">{fontSize}</p>
              </div>
              <div className="text-center p-3 bg-default-100 rounded-lg">
                <p className="font-medium text-default-900">缩放因子</p>
                <p className="text-default-600">{scaleFactor}x</p>
              </div>
              <div className="text-center p-3 bg-default-100 rounded-lg">
                <p className="font-medium text-default-900">基础间距</p>
                <p className="text-default-600">{spacing.md.toFixed(1)}px</p>
              </div>
              <div className="text-center p-3 bg-default-100 rounded-lg">
                <p className="font-medium text-default-900">基础尺寸</p>
                <p className="text-default-600">{sizes.md.toFixed(1)}px</p>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* 使用说明 */}
        <Card className="w-full">
          <CardHeader>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Icon icon="solar:info-circle-bold" width={20} />
              使用说明
            </h2>
          </CardHeader>
          <CardBody>
            <div className="space-y-3 text-sm text-default-600">
              <p>
                <strong>自适应布局系统</strong>
                会根据选择的字体大小自动调整布局元素的尺寸和间距。
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="font-medium text-default-900 mb-2">
                    支持的缩放级别：
                  </p>
                  <ul className="space-y-1">
                    <li>• 小号字体: 0.85x 缩放</li>
                    <li>• 中号字体: 1.0x 缩放 (标准)</li>
                    <li>• 大号字体: 1.15x 缩放</li>
                    <li>• 超大字体: 1.3x 缩放</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-default-900 mb-2">
                    自动调整的元素：
                  </p>
                  <ul className="space-y-1">
                    <li>• 所有间距 (margin/padding/gap)</li>
                    <li>• 组件圆角半径</li>
                    <li>• 布局容器尺寸</li>
                    <li>• 图标和按钮大小</li>
                  </ul>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </AdaptiveLayoutContainer>
  );
};

export default AdaptiveLayoutDemo;
