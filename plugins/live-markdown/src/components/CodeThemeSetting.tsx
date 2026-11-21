import { CODE_THEMES, normalizeCodeTheme, type CodeTheme } from "../core/codeThemes";
import { SyntaxHighlightedCode } from "../core/codeSyntaxHighlighter";

export function CodeThemeSetting({ value, onChange }: { value: unknown; onChange: (theme: CodeTheme) => void }) {
  return <div className="ty-code-theme-setting">
    <label className="ty-pref-select-row">
      <span>代码高亮风格</span>
      <select data-testid="code-theme-select" value={normalizeCodeTheme(value)} onChange={(event) => onChange(normalizeCodeTheme(event.target.value))}>
        {CODE_THEMES.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
      </select>
    </label>
    <div className="ty-code-theme-preview" aria-label="代码高亮预览">
      <SyntaxHighlightedCode language="javascript" code={'// 代码预览\nconst message = "Hello";\nconsole.log(message, 42);'} showLineNumbers={false} />
    </div>
  </div>;
}
