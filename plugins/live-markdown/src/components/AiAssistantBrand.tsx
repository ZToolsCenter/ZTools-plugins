import React from "react";
import pluginLogo from "../../logo.svg?inline";
import "../styles/ai-assistant-brand.css";

export const AiAssistantBrand: React.FC = () => <div className="ty-ai-canvas-brand" aria-hidden="true">
  <div className="ty-ai-canvas-brand-mark">
    <img src={pluginLogo} alt="" />
    <span>AI 助手</span>
  </div>
</div>;
