import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { setupPluginLifecycle } from "@/lib/pluginHost";
import "./i18n";
import "./index.css";

setupPluginLifecycle();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
