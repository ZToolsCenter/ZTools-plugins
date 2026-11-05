import { decodeHTML } from "entities";
import { parse, defaultTreeAdapter, type DefaultTreeAdapterTypes } from "parse5";
import { projectCssPrivacyV2 } from "./content-css-projector";

const MAX_HTML_SCALARS = 10 * 1024 * 1024;
const MAX_RAW_HTML_BYTES = 10 * 1024 * 1024;
const MAX_TREE_NODES = 10_000;
const MAX_TREE_DEPTH = 128;
const MAX_URL_VALUES = 20_000;
const HEX_DIGITS = "0123456789abcdefABCDEF";
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "body", "br", "caption", "dd", "div", "dl", "dt",
  "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6",
  "head", "header", "hr", "html", "li", "main", "menu", "nav", "ol", "p", "pre", "section", "table",
  "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);
const URL_ATTRIBUTES = new Set([
  "action", "archive", "background", "cite", "classid", "code", "codebase", "data", "formaction", "href",
  "icon", "imagesrcset", "itemid", "itemtype", "longdesc", "manifest", "ping", "poster", "profile", "src",
  "srcset", "usemap", "xlink:href", "xml:base",
]);
const URL_METADATA_ATTRIBUTE = /(?:^|[-_])(?:href|link|src|uri|url)(?:$|[-_])/i;
const META_URL_KEY = /(?:url|uri|image|video|audio|player|stream|src)$/i;

type HtmlNode = DefaultTreeAdapterTypes.Node;
type UrlProjectionV2 = Readonly<{ complete: boolean; values: readonly string[] }>;
export type HtmlPrivacyProjectionV2 = Readonly<{
  decodedSource: string; textComplete: boolean; textValues: readonly string[];
  linksComplete: boolean; linkValues: readonly string[];
}>;

function scalarCountWithinLimit(value: string): number | undefined {
  let count = 0;
  for (const _character of value) {
    count += 1;
    if (count > MAX_HTML_SCALARS) return undefined;
  }
  return count;
}
function isHexDigit(value: string | undefined): boolean {
  return value !== undefined && HEX_DIGITS.includes(value);
}
function containsPercentEscape(value: string): boolean {
  for (let index = 0; index + 2 < value.length; index += 1) {
    if (value[index] === "%" && isHexDigit(value[index + 1]) && isHexDigit(value[index + 2])) return true;
  }
  return false;
}

// Retains v15 behavior: caller keeps raw, followed by at most two percent-decoding passes.
export function projectUrlTextV2(raw: string): UrlProjectionV2 {
  if (!raw.includes("%")) return { complete: true, values: [raw] };

  let first: string;
  try {
    first = decodeURIComponent(raw);
  } catch {
    return { complete: false, values: [] };
  }
  if (scalarCountWithinLimit(first) === undefined) return { complete: false, values: [] };
  if (!first.includes("%")) return { complete: true, values: [first] };
  if (!containsPercentEscape(first)) return { complete: false, values: [first] };

  let second: string;
  try {
    second = decodeURIComponent(first);
  } catch {
    return { complete: false, values: [first] };
  }
  if (scalarCountWithinLimit(second) === undefined || second.includes("%")) {
    return { complete: false, values: [first, second] };
  }
  return { complete: true, values: [first, second] };
}
function makeParsedTree(html: string, scriptingEnabled: boolean): Readonly<{ root?: HtmlNode; errors: boolean }> {
  let errors = false;
  try {
    const root = parse(html, {
      scriptingEnabled,
      onParseError(error) {
        if (error.code !== "missing-doctype") errors = true;
      },
    });
    return { root, errors };
  } catch {
    return { errors: true };
  }
}
// Static parse only: no DOM, script/CSS execution, URL fetches, or resource loads.
export function projectHtmlPrivacyV2(html: string, rawByteLength: number): HtmlPrivacyProjectionV2 {
  const empty = (decodedSource = ""): HtmlPrivacyProjectionV2 => ({
    decodedSource,
    textComplete: false,
    textValues: [],
    linksComplete: false,
    linkValues: [],
  });
  if (!Number.isSafeInteger(rawByteLength) || rawByteLength < 0 || rawByteLength > MAX_RAW_HTML_BYTES) return empty();
  if (scalarCountWithinLimit(html) === undefined) return empty();

  let decodedSource: string;
  try {
    decodedSource = decodeHTML(html);
  } catch {
    return empty();
  }
  const decodedSourceScalars = scalarCountWithinLimit(decodedSource);
  if (decodedSourceScalars === undefined) return empty();

  const textValues: string[] = [];
  const linkValues: string[] = [];
  let textComplete = true;
  let linksComplete = true;
  let projectedScalars = decodedSourceScalars;
  let nodeCount = 0;
  let urlValueCount = 0;
  let stop = false;
  function reserve(value: string): boolean {
    const count = scalarCountWithinLimit(value);
    if (count === undefined || projectedScalars + count > MAX_HTML_SCALARS) {
      textComplete = false;
      linksComplete = false;
      stop = true;
      return false;
    }
    projectedScalars += count;
    return true;
  }
  function reserveCount(count: number): boolean {
    if (projectedScalars + count > MAX_HTML_SCALARS) {
      textComplete = false;
      linksComplete = false;
      stop = true;
      return false;
    }
    projectedScalars += count;
    return true;
  }
  function addLink(raw: string): void {
    if (urlValueCount >= MAX_URL_VALUES) {
      linksComplete = false;
      return;
    }
    urlValueCount += 1;
    if (reserve(raw)) linkValues.push(raw);
    else return;
    if (!raw.includes("%")) return;
    const rawScalars = scalarCountWithinLimit(raw);
    if (rawScalars === undefined || projectedScalars + rawScalars * 2 > MAX_HTML_SCALARS) {
      textComplete = false;
      linksComplete = false;
      stop = true;
      return;
    }
    const projection = projectUrlTextV2(raw);
    linksComplete = linksComplete && projection.complete;
    for (const candidate of projection.values) {
      if (candidate === raw) continue;
      if (urlValueCount >= MAX_URL_VALUES) {
        linksComplete = false;
        break;
      }
      urlValueCount += 1;
      if (reserve(candidate)) linkValues.push(candidate);
      else break;
    }
  }
  function addTreeProjection(chunks: readonly string[], removeWhitespace = false): void {
    let totalScalars = 0;
    for (const chunk of chunks) {
      const count = scalarCountWithinLimit(chunk);
      if (count === undefined || totalScalars + count > MAX_HTML_SCALARS) {
        textComplete = false;
        return;
      }
      totalScalars += count;
    }
    if (removeWhitespace) {
      let compactScalars = 0;
      for (const chunk of chunks) {
        for (const character of chunk) {
          if (!/\s/u.test(character)) compactScalars += 1;
        }
      }
      if (!reserveCount(compactScalars)) return;
      const joined = chunks.join("");
      textValues.push(joined.replace(/\s+/gu, ""));
      return;
    }
    if (!reserveCount(totalScalars)) return;
    textValues.push(chunks.join(""));
  }
  function collectTree(root: HtmlNode, parseErrors: boolean): boolean {
    if (parseErrors) {
      textComplete = false;
      linksComplete = false;
    }
    const flowChunks: string[] = [];
    const flattenedTextChunks: string[] = [];
    const metadataChunks: string[] = [];
    let hasNoScript = false;
    const stack: Array<Readonly<{ node: HtmlNode; depth: number; afterBlock?: boolean }>> = [{ node: root, depth: 0 }];

    while (stack.length > 0 && !stop) {
      const entry = stack.pop();
      if (entry === undefined) break;
      if (entry.afterBlock) {
        flowChunks.push("\n");
        continue;
      }
      const node = entry.node;
      if (nodeCount >= MAX_TREE_NODES) {
        textComplete = false;
        linksComplete = false;
        break;
      }
      nodeCount += 1;
      const element = defaultTreeAdapter.isElementNode(node) ? node : undefined;
      const tagName = element?.tagName.toLowerCase();
      if (tagName === "noscript") hasNoScript = true;
      if (tagName !== undefined && element?.namespaceURI !== undefined && element.namespaceURI !== HTML_NAMESPACE) {
        textComplete = false;
        linksComplete = false;
      }
      if (tagName !== undefined && tagName.includes("-") ) {
        textComplete = false;
        linksComplete = false;
      }
      if (tagName === "script" || tagName === "iframe" || tagName === "object" || tagName === "embed" ||
          tagName === "frame" || tagName === "frameset" || tagName === "applet" || tagName === "portal" ||
          tagName === "fencedframe") {
        textComplete = false;
        linksComplete = false;
      }
      if (tagName === "audio" || tagName === "video" || tagName === "track" || tagName === "img" ||
          tagName === "picture" || tagName === "source" || tagName === "canvas") textComplete = false;
      const isBlock = tagName !== undefined && BLOCK_TAGS.has(tagName);
      if (isBlock) flowChunks.push("\n");

      const attrs = element?.attrs ?? [];
      let metaName = "";
      let metaProperty = "";
      let metaItemProp = "";
      let metaHttpEquiv = "";
      let metaContent: string | undefined;
      let relValue = "";
      let inputType = "";
      for (const attr of attrs) {
        const name = attr.name.toLowerCase();
        if (name === "name") metaName = attr.value;
        else if (name === "property") metaProperty = attr.value;
        else if (name === "itemprop") metaItemProp = attr.value;
        else if (name === "http-equiv") metaHttpEquiv = attr.value;
        else if (name === "content") metaContent = attr.value;
        else if (name === "rel") relValue = attr.value;
        else if (name === "type") inputType = attr.value;

        if (!reserve(name) || !reserve(attr.value)) break;
        metadataChunks.push(name, "=", attr.value, "\n");
        flattenedTextChunks.push(name, attr.value);
        if (name.startsWith("on")) {
          textComplete = false;
          linksComplete = false;
        }
        if (name === "srcdoc") {
          textComplete = false;
          linksComplete = false;
        }
        // Encoded metadata may carry URI content under application-specific
        // names. Scan bounded decoded variants without depending on a key list.
        // CSS owns its own escaping/URL rules; ordinary 50% styles stay literal.
        if (URL_ATTRIBUTES.has(name) || URL_METADATA_ATTRIBUTE.test(name) ||
            (name !== "style" && containsPercentEscape(attr.value))) addLink(attr.value);
        if (name === "style") {
          const css = projectCssPrivacyV2(attr.value);
          if (!css.complete) {
            textComplete = false;
            linksComplete = false;
          }
          if (!reserve(css.text)) break;
          metadataChunks.push(css.text);
          if (css.comments) {
            if (!reserve(css.comments)) break;
            metadataChunks.push(css.comments);
          }
          textComplete = textComplete && css.textComplete;
          linksComplete = linksComplete && css.linksComplete;
          for (const cssUrl of css.urlValues) addLink(cssUrl);
        }
        if (stop) break;
      }
      if (stop) break;

      if (tagName === "link" && relValue.toLowerCase().split(/\s+/u).includes("stylesheet")) textComplete = false;
      if (tagName === "input" && inputType.toLowerCase() === "image") textComplete = false;

      if (tagName === "meta" && metaContent !== undefined) {
        const metaKey = metaProperty || metaName || metaItemProp;
        if (metaHttpEquiv.trim().toLowerCase() === "refresh" || META_URL_KEY.test(metaKey.trim())) {
          addLink(metaContent);
          if (metaHttpEquiv.trim().toLowerCase() === "refresh" && !/(?:^|;)\s*url\s*=/iu.test(metaContent)) {
            linksComplete = false;
          }
        }
      }

      if (defaultTreeAdapter.isTextNode(node)) {
        if (!reserve(node.value)) break;
        flowChunks.push(node.value);
        flattenedTextChunks.push(node.value);
      } else if (defaultTreeAdapter.isCommentNode(node)) {
        if (!reserve(node.data)) break;
        metadataChunks.push(node.data);
        flattenedTextChunks.push(node.data);
      }

      if (tagName === "style") {
        const styleChildren = element?.childNodes ?? [];
        const cssSource: string[] = [];
        for (const child of styleChildren) {
          if (defaultTreeAdapter.isTextNode(child)) cssSource.push(child.value);
          else {
            textComplete = false;
            linksComplete = false;
          }
        }
        let rawCssScalars = 0;
        for (const chunk of cssSource) {
          const count = scalarCountWithinLimit(chunk);
          if (count === undefined || rawCssScalars + count > MAX_HTML_SCALARS) {
            textComplete = false;
            linksComplete = false;
            stop = true;
            break;
          }
          rawCssScalars += count;
        }
        if (stop) break;
        if (!reserveCount(rawCssScalars)) break;
        const rawCss = cssSource.join("");
        const css = projectCssPrivacyV2(rawCss);
        if (!css.complete) {
          textComplete = false;
          linksComplete = false;
        }
        if (!reserve(css.text)) break;
        metadataChunks.push(css.text);
        if (css.comments) {
          if (!reserve(css.comments)) break;
          metadataChunks.push(css.comments);
        }
        textComplete = textComplete && css.textComplete;
        linksComplete = linksComplete && css.linksComplete;
        for (const cssUrl of css.urlValues) addLink(cssUrl);
      }

      const children = element?.tagName === "template" && element.namespaceURI === HTML_NAMESPACE
        ? [defaultTreeAdapter.getTemplateContent(element as DefaultTreeAdapterTypes.Template)]
        : "childNodes" in node ? node.childNodes : [];
      if (children.length > 0 && entry.depth >= MAX_TREE_DEPTH) {
        textComplete = false;
        linksComplete = false;
        continue;
      }
      if (isBlock) stack.push({ node, depth: entry.depth, afterBlock: true });
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child === undefined) { textComplete = false; linksComplete = false; continue; }
        stack.push({ node: child, depth: entry.depth + 1 });
      }
    }

    addTreeProjection(flowChunks);
    addTreeProjection(flattenedTextChunks);
    addTreeProjection(flattenedTextChunks, true);
    addTreeProjection(metadataChunks);
    return hasNoScript;
  }

  if (projectedScalars >= MAX_HTML_SCALARS) return empty(decodedSource);
  const primary = makeParsedTree(html, true);
  if (primary.root === undefined) return empty(decodedSource);
  const hasNoScript = collectTree(primary.root, primary.errors);
  if (hasNoScript && !stop) {
    const alternate = makeParsedTree(html, false);
    if (alternate.root === undefined) {
      textComplete = false;
      linksComplete = false;
    } else {
      collectTree(alternate.root, alternate.errors);
    }
  }

  return {
    decodedSource,
    textComplete,
    textValues,
    linksComplete,
    linkValues,
  };
}
