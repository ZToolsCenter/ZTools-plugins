import { Route, Routes } from "react-router-dom";

import IndexPage from "@/pages/indexPage";
import SettingsPage from "@/pages/settingPage";
import ToolboxPage from "@/pages/toolboxPage";
import HistoryPage from "@/pages/historyPage";
import JsonAIRepairPage from "@/pages/tools/jsonAIRepairPage.tsx";
import JsonTypeConverter from "@/pages/tools/jsonTypeConverterPage.tsx";
import DataFormatConverter from "@/pages/tools/dataFormatConverterPage.tsx";
import JwtParsePage from "@/pages/tools/jwtParsePage.tsx";

function App() {
  return (
    <Routes>
      <Route element={<IndexPage />} path="/" />
      <Route element={<SettingsPage />} path="/settings" />
      <Route element={<ToolboxPage />} path="/toolbox" />
      <Route element={<HistoryPage />} path="/history" />
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
  );
}

export default App;
