import React, { Suspense } from "react";
import { Route, Routes } from "react-router-dom";

import IndexPage from "@/pages/indexPage";
import SettingsPage from "@/pages/settingPage";
import ToolboxPage from "@/pages/toolboxPage";

// Monaco 编辑器相关页面懒加载，减少首屏包体积
const JsonAIRepairPage = React.lazy(
  () => import("@/pages/tools/jsonAIRepairPage.tsx"),
);
const JsonTypeConverter = React.lazy(
  () => import("@/pages/tools/jsonTypeConverterPage.tsx"),
);
const DataFormatConverter = React.lazy(
  () => import("@/pages/tools/dataFormatConverterPage.tsx"),
);
const JwtParsePage = React.lazy(
  () => import("@/pages/tools/jwtParsePage.tsx"),
);

/** 页面级加载占位符 */
const PageLoader = () => (
  <div className="flex items-center justify-center h-full w-full">
    <div className="text-sm text-default-400">加载中...</div>
  </div>
);

function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route element={<IndexPage />} path="/" />
        <Route element={<SettingsPage />} path="/settings" />
        <Route element={<ToolboxPage />} path="/toolbox" />
        <Route element={<JsonAIRepairPage />} path="/toolbox/jsonAIRepair" />
        <Route
          element={<JsonTypeConverter />}
          path="/toolbox/jsonTypeConverter"
        />
        <Route
          element={<DataFormatConverter />}
          path="/toolbox/dataFormatConverter"
        />
        <Route element={<JwtParsePage />} path="/toolbox/jwtParse" />
      </Routes>
    </Suspense>
  );
}

export default App;
