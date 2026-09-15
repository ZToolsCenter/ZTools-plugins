/**
 * Prompt Bar chrome: CSS shimmer replaces glimm shader.
 * Wraps the existing Composer card — does not replace input/controls.
 */
import type { ReactNode } from "react";

export function PromptBarChrome({
  active,
  children,
  loader,
}: {
  active?: boolean;
  children: ReactNode;
  loader?: ReactNode;
}) {
  return (
    <div
      className={
        active ? "bui bui-prompt-bar bui-prompt-bar--active" : "bui bui-prompt-bar"
      }
    >
      {loader ? <div className="bui-prompt-bar__loader">{loader}</div> : null}
      {children}
    </div>
  );
}
