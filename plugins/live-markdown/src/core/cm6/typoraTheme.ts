import { EditorView } from "@codemirror/view";
import { Extension } from "@codemirror/state";

/**
 * Typora-aligned CodeMirror 6 Theme
 * Seamlessly integrates with Typora CSS custom properties (--text-color, --bg-color, etc.)
 * across all light and dark themes (github, night, newsprint, pixyll, whitey, gothic).
 */
export const typoraCM6Theme: Extension = EditorView.theme({
  "&": {
    height: "100%",
    flex: "1 1 0%",
    minHeight: "0",
    backgroundColor: "transparent",
    color: "var(--text-color, #24292e) !important",
    fontFamily:
      'var(--font-content, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif)',
    fontSize: "var(--editor-font-size, 16px)",
    lineHeight: "1.65"
  },
  ".cm-content": {
    maxWidth: "var(--editor-max-width, 860px)",
    margin: "0 auto",
    padding: "36px 56px 240px 56px",
    boxSizing: "border-box",
    caretColor: "var(--primary-color, #0969da)",
    color: "var(--text-color, inherit) !important",
    fontFamily: "inherit"
  },
  ".cm-line": {
    padding: "0",
    minHeight: "1.65em",
    color: "var(--text-color, inherit) !important"
  },
  ".cm-line *": {
    color: "inherit"
  },
  "&.cm-focused": {
    outline: "none"
  },
  ".cm-scroller": {
    fontFamily: "inherit",
    overflow: "auto !important",
    height: "100% !important",
    flex: "1 1 auto",
    color: "var(--text-color, inherit) !important"
  },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "var(--sidebar-active-bg, rgba(9, 105, 218, 0.25)) !important"
  },
  ".cm-cursor": {
    borderLeftColor: "var(--primary-color, #0969da) !important",
    borderLeftWidth: "2px"
  },

  // Syntax Ghost Marks (e.g. unfolded #, **, ~~, `)
  ".cm-ghost-mark": {
    color: "var(--muted-text-color, #8c959f) !important",
    opacity: "0.65",
    fontFamily: 'var(--font-mono, monospace)',
    fontWeight: "normal",
    fontStyle: "normal",
    fontSize: "0.85em",
    letterSpacing: "0.02em"
  },
  ".cm-heading-mark": {
    marginRight: "4px"
  },

  // Headings
  ".cm-heading": {
    fontFamily: "inherit",
    color: "var(--text-color, inherit) !important"
  },
  ".cm-heading-1": {
    fontSize: "2.15em",
    fontWeight: "700",
    lineHeight: "1.25",
    color: "var(--text-color, inherit) !important"
  },
  ".cm-heading-2": {
    fontSize: "1.75em",
    fontWeight: "600",
    lineHeight: "1.3",
    color: "var(--text-color, inherit) !important"
  },
  ".cm-heading-3": {
    fontSize: "1.4em",
    fontWeight: "600",
    lineHeight: "1.35",
    color: "var(--text-color, inherit) !important"
  },
  ".cm-heading-4": {
    fontSize: "1.2em",
    fontWeight: "600",
    lineHeight: "1.4",
    color: "var(--text-color, inherit) !important"
  },
  ".cm-heading-5": {
    fontSize: "1.05em",
    fontWeight: "600",
    color: "var(--text-color, inherit) !important"
  },
  ".cm-heading-6": {
    fontSize: "1em",
    fontWeight: "600",
    color: "var(--muted-text-color, #6a737d) !important"
  },

  // Inline formatting
  ".cm-bold": {
    fontWeight: "700",
    color: "var(--text-color, inherit) !important"
  },
  ".cm-italic": {
    fontStyle: "italic",
    color: "var(--text-color, inherit) !important"
  },
  ".cm-strike": {
    textDecoration: "line-through",
    opacity: "0.75",
    color: "var(--muted-text-color, #6a737d) !important"
  },
  ".cm-inline-code": {
    backgroundColor: "var(--code-bg, rgba(128, 128, 128, 0.12))",
    color: "var(--code-text, var(--text-color)) !important",
    padding: "0.15em 0.35em",
    borderRadius: "4px",
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: "0.88em",
    border: "1px solid var(--border-color, rgba(128, 128, 128, 0.18))"
  },
  ".cm-link-text": {
    color: "var(--primary-color, #0969da) !important",
    textDecoration: "underline",
    cursor: "pointer"
  },

  // Blockquotes
  ".cm-blockquote-line": {
    borderLeft: "4px solid var(--primary-color, #0969da)",
    paddingLeft: "14px",
    color: "var(--blockquote-text, var(--muted-text-color)) !important",
    fontStyle: "italic"
  },

  // Code blocks
  ".cm-codeblock-line": {
    backgroundColor: "var(--code-bg, rgba(128, 128, 128, 0.12))",
    color: "var(--code-text, var(--text-color)) !important",
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: "0.9em",
    paddingLeft: "12px",
    paddingRight: "12px"
  }
});
