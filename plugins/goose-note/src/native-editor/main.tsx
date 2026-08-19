import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { applyRolldownPolyfills } from "@/lib/rolldown-polyfill";
import "../pages/workspace/styles/editor-base.css";
import "../pages/workspace/styles/block-background.css";
import "../pages/workspace/styles/editor-popup-position.css";
import "../pages/workspace/styles/code-themes.css";
import "katex/dist/katex.min.css";
import "./foundation.css";
import "virtual:native-editor-tokens.css";
import "./native-editor.css";
import { NativeEditorApp } from "./NativeEditorApp";

applyRolldownPolyfills();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <NativeEditorApp />
    <Toaster position="bottom-center" />
  </React.StrictMode>,
);
