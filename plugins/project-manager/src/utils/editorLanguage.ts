import type { Extension } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { vue } from '@codemirror/lang-vue';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { rust } from '@codemirror/lang-rust';
import { go } from '@codemirror/lang-go';
import { cpp } from '@codemirror/lang-cpp';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { dart } from '@codemirror/legacy-modes/mode/clike';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { toml } from '@codemirror/legacy-modes/mode/toml';

interface DotenvState {
  phase: 'key' | 'beforeValue' | 'value';
  quote: 'single' | 'double' | null;
}

const dotenv = StreamLanguage.define<DotenvState>({
  name: 'dotenv',
  startState: () => ({ phase: 'key', quote: null }),
  token(stream, state) {
    if (stream.sol() && !state.quote) state.phase = 'key';

    if (state.quote) {
      const quote = state.quote === 'single' ? "'" : '"';
      if (stream.peek() === quote) {
        stream.next();
        state.quote = null;
        state.phase = 'value';
        return 'string';
      }
      if (stream.match(/^\$\{[A-Za-z_][A-Za-z0-9_]*\}/)) return 'variableName';

      const start = stream.pos;
      while (!stream.eol()) {
        const ch = stream.peek();
        if (ch === quote || (ch === '$' && stream.string[stream.pos + 1] === '{')) break;
        if (ch === '\\') {
          stream.next();
          if (!stream.eol()) stream.next();
        } else {
          stream.next();
        }
      }
      if (stream.pos === start) stream.next();
      return 'string';
    }

    if (stream.eatSpace()) return null;
    if (stream.peek() === '#') {
      stream.skipToEnd();
      return 'comment';
    }

    if (state.phase === 'key') {
      if (stream.match(/^export\b/)) return 'keyword';
      if (stream.match(/^[A-Za-z_][A-Za-z0-9_.-]*/)) {
        state.phase = 'beforeValue';
        return 'variableName.definition';
      }
      stream.next();
      return null;
    }

    if (state.phase === 'beforeValue') {
      if (stream.match(/^=/)) {
        state.phase = 'value';
        return 'operator';
      }
      stream.next();
      return null;
    }

    const quote = stream.peek();
    if (quote === "'" || quote === '"') {
      stream.next();
      state.quote = quote === "'" ? 'single' : 'double';
      return 'string';
    }
    const token = stream.match(/^[^\s#]+/) as RegExpMatchArray | null;
    if (token) {
      const value = token[0];
      if (/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value)) return 'variableName';
      if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return 'number';
      if (/^(?:true|false)$/i.test(value)) return 'bool';
      if (/^null$/i.test(value)) return 'atom';
      return 'string';
    }
    stream.next();
    return null;
  },
});

export type EditorLanguage =
  | 'javascript'
  | 'typescript'
  | 'jsx'
  | 'tsx'
  | 'vue'
  | 'json'
  | 'html'
  | 'css'
  | 'markdown'
  | 'python'
  | 'java'
  | 'rust'
  | 'go'
  | 'dart'
  | 'cpp'
  | 'shell'
  | 'yaml'
  | 'toml'
  | 'xml'
  | 'sql'
  | 'dotenv'
  | 'plain';

export function editorLanguageForPath(path: string): EditorLanguage {
  const name = path.replace(/\\/g, '/').split('/').pop()?.toLowerCase() || '';
  if (name === '.vue') return 'vue';
  if (name.endsWith('.vue')) return 'vue';
  if (name === '.env' || name.startsWith('.env.')) return 'dotenv';
  if (/\.(tsx)$/.test(name)) return 'tsx';
  if (/\.(jsx)$/.test(name)) return 'jsx';
  if (/\.(ts|mts|cts)$/.test(name)) return 'typescript';
  if (/\.(js|mjs|cjs)$/.test(name)) return 'javascript';
  if (/\.(json|jsonc)$/.test(name)) return 'json';
  if (/\.(html|htm)$/.test(name)) return 'html';
  if (/\.(css|scss|sass|less)$/.test(name)) return 'css';
  if (/\.(md|markdown)$/.test(name)) return 'markdown';
  if (/\.(py|pyw)$/.test(name)) return 'python';
  if (/\.(java)$/.test(name)) return 'java';
  if (/\.(rs)$/.test(name)) return 'rust';
  if (/\.(go)$/.test(name)) return 'go';
  if (/\.(dart)$/.test(name)) return 'dart';
  if (/\.(c|h|cc|cpp|cxx|hh|hpp|hxx)$/.test(name)) return 'cpp';
  if (/\.(sh|bash|zsh)$/.test(name)) return 'shell';
  if (/\.(yaml|yml)$/.test(name)) return 'yaml';
  if (/\.(toml)$/.test(name)) return 'toml';
  if (/\.(xml|xhtml|svg)$/.test(name)) return 'xml';
  if (/\.(sql)$/.test(name)) return 'sql';
  return 'plain';
}

export function editorLanguageExtension(language: EditorLanguage): Extension {
  switch (language) {
    case 'typescript': return javascript({ typescript: true });
    case 'javascript': return javascript();
    case 'jsx': return javascript({ jsx: true });
    case 'tsx': return javascript({ jsx: true, typescript: true });
    case 'json': return json();
    case 'html': return html();
    case 'css': return css();
    case 'markdown': return markdown();
    case 'vue': return vue({ base: html() });
    case 'python': return python();
    case 'java': return java();
    case 'rust': return rust();
    case 'go': return go();
    case 'dart': return StreamLanguage.define(dart);
    case 'cpp': return cpp();
    case 'shell': return StreamLanguage.define(shell);
    case 'yaml': return yaml();
    case 'toml': return StreamLanguage.define(toml);
    case 'xml': return xml();
    case 'sql': return sql();
    case 'dotenv': return dotenv;
    default: return [];
  }
}
