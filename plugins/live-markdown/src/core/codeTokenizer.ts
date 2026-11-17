import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import sql from "highlight.js/lib/languages/sql";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import yaml from "highlight.js/lib/languages/yaml";
import java from "highlight.js/lib/languages/java";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import scss from "highlight.js/lib/languages/scss";
import ini from "highlight.js/lib/languages/ini";
import graphql from "highlight.js/lib/languages/graphql";
import markdown from "highlight.js/lib/languages/markdown";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import swift from "highlight.js/lib/languages/swift";
import kotlin from "highlight.js/lib/languages/kotlin";
import ruby from "highlight.js/lib/languages/ruby";
import php from "highlight.js/lib/languages/php";

const grammars = { javascript, typescript, python, json, bash, sql, xml, css, yaml, java, go, rust, c, cpp, csharp, scss, ini, graphql, markdown, dockerfile, swift, kotlin, ruby, php };
for (const [name, grammar] of Object.entries(grammars)) hljs.registerLanguage(name, grammar);
export const SUPPORTED_CODE_LANGUAGES = ["javascript", "typescript", "jsx", "tsx", "python", "json", "bash", "shell", "sql", "html", "xml", "css", "yaml", "java", "go", "rust", "c", "cpp", "csharp", "scss", "toml", "graphql", "markdown", "dockerfile", "swift", "kotlin", "ruby", "php", "plaintext"];
const aliases: Record<string, string> = { toml: "ini", md: "markdown", mdx: "markdown", js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", py: "python", sh: "bash", shell: "bash", zsh: "bash", html: "xml", svg: "xml", yml: "yaml", rs: "rust", golang: "go", "c++": "cpp", "c#": "csharp", cs: "csharp" };
export interface CodeToken { type: string; value: string }
const MAX_CODE_CHARS = 64_000;
const MAX_LINE_CHARS = 2_000;
const cache = new Map<string, CodeToken[]>();
const MAX_CACHE_CHARS = 256_000;
let cacheChars = 0;

/** Highlight.js produces escaped HTML. Read only its generated span classes and use
 * lengths to slice the original source, so source characters are never interpreted as HTML. */
function readTokens(code: string, html: string): CodeToken[] {
  const result: CodeToken[] = [];
  const stack: string[] = [];
  let offset = 0;
  const parts = html.match(/<span class="[^"]*">|<\/span>|[^<]+/g) || [];
  for (const part of parts) {
    if (part.startsWith('<span class="')) {
      const classes = part.slice(13, -2).split(/\s+/).filter((name) => /^[\w-]+$/.test(name));
      stack.push(classes.join(" "));
    } else if (part === "</span>") stack.pop();
    else {
      const length = part.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, "x").length;
      const value = code.slice(offset, offset + length);
      const type = stack.filter(Boolean).join(" ") || "plain";
      const previous = result[result.length - 1];
      if (previous?.type === type) previous.value += value;
      else result.push({ type, value });
      offset += length;
    }
  }
  return offset === code.length ? result : [{ type: "plain", value: code }];
}
export function tokenizeCode(code: string, language = ""): CodeToken[] {
  const raw = language.trim().split(/\s+/, 1)[0].toLowerCase();
  const lang = aliases[raw] || raw;
  if (!hljs.getLanguage(lang) || code.length > MAX_CODE_CHARS || code.split(/\r?\n/).some((line) => line.length > MAX_LINE_CHARS)) return [{ type: "plain", value: code }];
  const key = `${lang}\0${code}`;
  const cached = cache.get(key);
  if (cached) return cached;
  let tokens: CodeToken[];
  try { tokens = readTokens(code, hljs.highlight(code, { language: lang, ignoreIllegals: true }).value); }
  catch { return [{ type: "plain", value: code }]; }
  while (cache.size && cacheChars + key.length > MAX_CACHE_CHARS) {
    const oldest = cache.keys().next().value as string;
    cacheChars -= oldest.length;
    cache.delete(oldest);
  }
  cache.set(key, tokens);
  cacheChars += key.length;
  return tokens;
}
