import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WidgetType, EditorView } from "@codemirror/view";
import { MermaidDiagramView, MathFormulaView, cleanMermaidCode } from "../mathAndDiagramRenderer";
export { TableBlockWidget } from "./tableBlockWidget";

/**
 * Interactive Task List Checkbox Widget for CM6
 * Replaces `[ ]` or `[x]` with a native-feeling interactive checkbox.
 */
export class TaskCheckboxWidget extends WidgetType {
  constructor(
    public readonly checked: boolean,
    public readonly from: number,
    public readonly to: number
  ) {
    super();
  }

  eq(other: TaskCheckboxWidget): boolean {
    return this.checked === other.checked && this.from === other.from && this.to === other.to;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-task-checkbox-wrap";
    wrap.style.display = "inline-flex";
    wrap.style.alignItems = "center";
    wrap.style.verticalAlign = "middle";
    wrap.style.marginRight = "6px";
    wrap.style.cursor = "pointer";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.className = "ty-task-checkbox";
    input.style.cursor = "pointer";
    input.style.margin = "0";

    input.addEventListener("click", (e) => {
      e.stopPropagation();
      const nextChecked = !this.checked;
      const nextText = nextChecked ? "[x]" : "[ ]";
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: nextText }
      });
    });

    wrap.appendChild(input);
    return wrap;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== "click";
  }
}

/**
 * Horizontal Rule Divider Widget
 */
export class HrWidget extends WidgetType {
  toDOM(): HTMLElement {
    const hr = document.createElement("hr");
    hr.className = "ty-hr ty-cm6-hr";
    hr.style.margin = "0";
    hr.style.padding = "0.45em 0";
    hr.style.boxSizing = "border-box";
    hr.style.border = "none";
    hr.style.borderTop = "2px solid var(--border-color, #e1e4e8)";
    return hr;
  }
}

/**
 * Fenced Code Block Header Widget (Language badge + Copy button)
 */
export class CodeBlockHeaderWidget extends WidgetType {
  constructor(public readonly language: string, public readonly codeContent: string) {
    super();
  }

  eq(other: CodeBlockHeaderWidget): boolean {
    return this.language === other.language && this.codeContent === other.codeContent;
  }

  toDOM(): HTMLElement {
    const header = document.createElement("div");
    header.className = "ty-codeblock-header";
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.padding = "4px 8px";
    header.style.fontSize = "12px";
    header.style.color = "var(--muted-text-color, #6a737d)";
    header.style.borderBottom = "1px solid var(--border-color, #e1e4e8)";
    header.style.marginBottom = "4px";
    header.style.userSelect = "none";

    const langSpan = document.createElement("span");
    langSpan.className = "ty-codeblock-lang";
    langSpan.textContent = this.language || "text";
    langSpan.style.fontWeight = "600";
    langSpan.style.textTransform = "uppercase";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "ty-codeblock-copy-btn";
    copyBtn.textContent = "复制";
    copyBtn.style.background = "transparent";
    copyBtn.style.border = "none";
    copyBtn.style.color = "inherit";
    copyBtn.style.cursor = "pointer";
    copyBtn.style.fontSize = "11px";
    copyBtn.setAttribute("aria-label", "复制代码");

    // Keep pointer interaction from moving the editor selection, while leaving
    // the native keyboard-generated click intact for Enter and Space activation.
    copyBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
    copyBtn.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    copyBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      let copied = false;
      if (window.typoraBridge?.copyTextToClipboard) {
        try {
          copied = (await window.typoraBridge.copyTextToClipboard(this.codeContent)) === true;
        } catch {
          // Fall back to the browser clipboard when the host bridge is unavailable.
        }
      }
      if (!copied && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(this.codeContent);
          copied = true;
        } catch {
          // Clipboard access is optional in file:// and restricted host contexts.
        }
      }
      if (!copyBtn.isConnected) return;
      const message = copied ? "已复制!" : "复制失败";
      copyBtn.textContent = message;
      copyBtn.setAttribute("aria-label", copied ? "已复制代码" : "复制代码失败");
      setTimeout(() => {
        if (!copyBtn.isConnected) return;
        copyBtn.textContent = "复制";
        copyBtn.setAttribute("aria-label", "复制代码");
      }, 1500);
    });

    header.appendChild(langSpan);
    header.appendChild(copyBtn);
    return header;
  }
}

/**
 * Mermaid Diagram Live Widget for CM6
 * Renders SVG diagram in place when unfocused, clicks into code on focus.
 */
export class MermaidBlockWidget extends WidgetType {
  constructor(
    public readonly code: string,
    public readonly from: number,
    public readonly to: number
  ) {
    super();
  }

  eq(other: MermaidBlockWidget): boolean {
    return this.code === other.code;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = "ty-diagram-block ty-cm6-mermaid-widget";
    container.style.margin = "0";
    container.style.padding = "0.55em 0";
    container.style.boxSizing = "border-box";
    container.style.cursor = "pointer";

    try {
      const html = renderToStaticMarkup(
        React.createElement(MermaidDiagramView, {
          code: cleanMermaidCode(this.code)
        })
      );
      container.innerHTML = html;
    } catch {
      container.textContent = "无法渲染 Mermaid 图表";
    }

    // Click to focus and edit diagram source
    container.addEventListener("click", () => {
      view.dispatch({
        selection: { anchor: this.from + 10 }
      });
      view.focus();
    });

    return container;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== "click";
  }
}

/**
 * Math Formula Block & Inline Widget for CM6
 */
export class MathBlockWidget extends WidgetType {
  constructor(
    public readonly tex: string,
    public readonly from: number,
    public readonly to: number,
    public readonly displayMode = true
  ) {
    super();
  }

  eq(other: MathBlockWidget): boolean {
    return this.tex === other.tex && this.displayMode === other.displayMode;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement(this.displayMode ? "div" : "span");
    container.className = this.displayMode
      ? "ty-math-block ty-cm6-math-widget"
      : "ty-math-inline ty-cm6-math-inline-widget";
    if (this.displayMode) {
      container.style.margin = "0";
      container.style.padding = "0.55em 0";
      container.style.boxSizing = "border-box";
      container.style.textAlign = "center";
    }
    container.style.cursor = "pointer";

    try {
      const html = renderToStaticMarkup(
        React.createElement(MathFormulaView, {
          tex: this.tex.trim(),
          displayMode: this.displayMode
        })
      );
      container.innerHTML = html;
    } catch {
      container.textContent = this.displayMode ? `$$ ${this.tex} $$` : `$${this.tex}$`;
    }

    container.addEventListener("click", () => {
      view.dispatch({
        selection: { anchor: this.from + (this.displayMode ? 2 : 1) }
      });
      view.focus();
    });

    return container;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== "click";
  }
}

/**
 * Callout Alert Block Widget for CM6 (e.g. > [!NOTE], > [!WARNING])
 */
export class AlertBlockWidget extends WidgetType {
  constructor(
    public readonly kind: string,
    public readonly content: string,
    public readonly from: number,
    public readonly to: number
  ) {
    super();
  }

  eq(other: AlertBlockWidget): boolean {
    return this.kind === other.kind && this.content === other.content;
  }

  toDOM(view: EditorView): HTMLElement {
    const alertDiv = document.createElement("div");
    alertDiv.className = `md-alert md-alert-${this.kind} ty-cm6-alert-widget`;
    alertDiv.style.cursor = "pointer";
    alertDiv.style.margin = "0";
    alertDiv.style.padding = "0.55em 0 0.55em 14px";
    alertDiv.style.boxSizing = "border-box";

    const titleDiv = document.createElement("div");
    titleDiv.className = "md-alert-title";
    titleDiv.textContent = this.kind;

    const contentDiv = document.createElement("div");
    contentDiv.textContent = this.content;

    alertDiv.appendChild(titleDiv);
    alertDiv.appendChild(contentDiv);

    alertDiv.addEventListener("click", () => {
      view.dispatch({ selection: { anchor: this.from + 2 } });
      view.focus();
    });

    return alertDiv;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== "click";
  }
}

export interface TocHeadingItem {
  level: number;
  text: string;
  from: number;
}

/**
 * Table of Contents [TOC] Widget for CM6
 */
export class TocBlockWidget extends WidgetType {
  constructor(public readonly headings: TocHeadingItem[]) {
    super();
  }

  eq(other: TocBlockWidget): boolean {
    if (this.headings.length !== other.headings.length) return false;
    for (let i = 0; i < this.headings.length; i++) {
      if (
        this.headings[i].text !== other.headings[i].text ||
        this.headings[i].from !== other.headings[i].from ||
        this.headings[i].level !== other.headings[i].level
      ) {
        return false;
      }
    }
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = "md-toc ty-toc-block ty-cm6-toc-widget";
    container.style.cursor = "default";
    container.style.margin = "0";
    container.style.padding = "12px 16px";
    container.style.boxSizing = "border-box";

    const header = document.createElement("div");
    header.className = "md-toc-title ty-toc-header";
    header.textContent = "目录 (Table of Contents)";
    container.appendChild(header);

    if (this.headings.length === 0) {
      const emptyTip = document.createElement("div");
      emptyTip.style.fontSize = "12px";
      emptyTip.style.color = "var(--muted-text-color)";
      emptyTip.textContent = "（文档中添加 # 标题 后将在此自动生成目录）";
      container.appendChild(emptyTip);
    } else {
      for (const h of this.headings) {
        const item = document.createElement("div");
        item.className = "md-toc-item";
        item.style.paddingLeft = `${(h.level - 1) * 16}px`;
        item.textContent = h.text;
        item.title = `跳转到: ${h.text}`;
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          view.dispatch({
            selection: { anchor: h.from },
            effects: EditorView.scrollIntoView(h.from, { y: "center" })
          });
          view.focus();
        });
        container.appendChild(item);
      }
    }

    return container;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== "click";
  }
}
