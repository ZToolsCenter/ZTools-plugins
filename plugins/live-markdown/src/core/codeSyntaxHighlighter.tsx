import React from "react";
import { tokenizeCode, type CodeToken } from "./codeTokenizer";
export { SUPPORTED_CODE_LANGUAGES } from "./codeTokenizer";

export const SyntaxHighlightedCode: React.FC<{
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  wrapLines?: boolean;
}> = ({ code, language = "", showLineNumbers = true, wrapLines = true }) => {
  const lines: CodeToken[][] = [[]];
  for (const token of tokenizeCode(String(code ?? ""), language)) {
    const pieces = token.value.split("\n");
    pieces.forEach((value, index) => {
      if (index) lines.push([]);
      if (value) lines[lines.length - 1].push({ ...token, value });
    });
  }
  return <div className={`ty-code-render ${wrapLines ? "is-wrapped" : "is-nowrap"}`}>
    {lines.map((tokens, idx) => <div key={idx} className="ty-code-line">
      {showLineNumbers && <span className="ty-code-linenum" aria-hidden="true">{idx + 1}</span>}
      <span className="ty-code-linetext">{tokens.length === 0 ? "\u00a0" : tokens.map((token, i) =>
        token.type === "plain" ? <React.Fragment key={i}>{token.value}</React.Fragment> : <span key={i} className={token.type}>{token.value}</span>)}</span>
    </div>)}
  </div>;
};
