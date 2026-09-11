import { useState } from "react";
import type { ThinkingTraceView } from "../beautifulUiMap";

export function ThinkingState({
  variant,
  activeLabel,
  doneLabel,
  rows,
  working = false,
  defaultExpanded,
}: ThinkingTraceView & {
  working?: boolean;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(
    defaultExpanded ?? (working && rows.length > 0),
  );

  return (
    <div className="bui-think" data-variant={variant}>
      <button
        type="button"
        className="bui-think-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden
        >
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </svg>
        <span role="status">
          {working ? (
            <span className="bui-loader-label">{activeLabel}</span>
          ) : (
            <span style={{ fontSize: 13, fontWeight: 500 }}>{doneLabel}</span>
          )}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="bui-think-chevron"
          style={{
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <div className="bui-think-rows" data-open={expanded ? "true" : "false"}>
        <div className="bui-think-rows-inner">
          {rows.map((row, index) => {
            const last = index === rows.length - 1;
            return (
              <div key={`${row.primary}-${index}`} className="bui-think-row">
                {variant === "Steps" ? (
                  last && working ? (
                    <span className="bui-think-spinner" />
                  ) : (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )
                ) : null}
                <span className="min-w-0 truncate">{row.primary}</span>
                {row.secondary ? (
                  <span className="bui-think-row-secondary">
                    {row.secondary}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
