import React from "react";
import { PencilLine } from "lucide-react";

interface Props {
  message: string;
  onEditPrompt: () => void;
}

export const AiFailureNotice: React.FC<Props> = ({ message, onEditPrompt }) => <section className="ty-ai-failure" role="alert" aria-live="assertive">
  <div className="ty-ai-failure-copy">
    <p className="ty-ai-error">{message}</p>
    <span>生成已结束，未写入文档。</span>
  </div>
  <button type="button" onClick={onEditPrompt} aria-label="修改指令并聚焦输入框">
    <PencilLine size={14}/><span>修改指令</span>
  </button>
</section>;
