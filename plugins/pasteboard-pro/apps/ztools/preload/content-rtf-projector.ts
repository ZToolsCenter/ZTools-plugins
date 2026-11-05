import { tokenizeRtfPrivacyV2 } from "./content-rtf-tokenizer";
import { decodeRtfBytesV2, rtfCodePageForCharsetV2 } from "./content-rtf-charset";
import { RtfPrivacyOutputV2, type RtfProjectionChannelV2 } from "./content-rtf-projections";
import { RtfAnnotationTrackerV2, type RtfAnnotationFrameV2 } from "./content-rtf-annotations";
import { projectUrlTextV2 } from "./content-html-projector";
import { collectRtfUrlCandidatesV2 } from "./content-rtf-links";
import {
  RTF_FORMATTING_CONTROLS_V2, RTF_METADATA_DESTINATIONS_V2, RTF_TEXT_CONTROLS_V2,
  RTF_TEXT_SYMBOLS_V2, isStaticRtfHyperlinkV2,
} from "./content-rtf-controls";

export type RtfPrivacyProjectionV2 = Readonly<{
  textComplete: boolean; linksComplete: boolean;
  textValues: readonly string[]; linkValues: readonly string[];
}>;
type Font = { id: number; charset?: number; codePage?: number; terminated: boolean; depth: number };
type Field = { instructions: number; results: number };
type State = {
  stream: number; destination: string; prefix: boolean; starred: boolean; hidden: boolean;
  annotationFrame: RtfAnnotationFrameV2;
  uc: number; font?: number; explicitCodePage?: number; definition?: Font; field?: Field;
  auditStreams?: readonly number[];
  channel: RtfProjectionChannelV2; uprChildren?: number; uprRole?: "legacy" | "modern"; udSeen?: boolean;
};
type ByteRun = { chunks: Uint8Array[]; size: number; codePage: number | undefined;
  stream: number; hidden: boolean; destination: string; annotationFrame: RtfAnnotationFrameV2;
  channel: RtfProjectionChannelV2;
  branch: RtfProjectionChannelV2; audits?: readonly number[] };
const ANNOTATION_TIME_FIELDS_V2 = new Set(["yr", "mo", "dy", "hr", "min", "sec"]);

function scalarText(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit === 0 || unit === 0xfffd) return false;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (i >= value.length || next < 0xdc00 || next > 0xdfff) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

export function projectRtfPrivacyV2(bytes: Uint8Array): RtfPrivacyProjectionV2 {
  const output = new RtfPrivacyOutputV2();
  const annotations = new RtfAnnotationTrackerV2();
  const stack: State[] = [];
  const fonts = new Map<number, Font>();
  const fields: Field[] = [];
  const rootStream = output.createStream("body");
  let complete = true;
  let documentCodePage = 1252;
  let defaultFont: number | undefined;
  let bodySeen = false;
  let skip = 0;
  let run: ByteRun | undefined;

  function append(value: string, state: Pick<State, "stream" | "destination" | "annotationFrame" | "hidden" | "channel" | "auditStreams">,
    channel: RtfProjectionChannelV2 = "both", trackSemanticText = true): void {
    if (trackSemanticText) annotations.noteText(state.annotationFrame, value);
    for (const stream of state.auditStreams ?? []) output.append(stream, value, channel, state.hidden);
    if (state.channel !== "both") {
      if (channel !== "both" && channel !== state.channel) return;
      channel = state.channel;
    }
    output.append(state.stream, value, channel, state.hidden);
  }
  function codePage(state: State): number | undefined {
    if (state.explicitCodePage !== undefined) return state.explicitCodePage;
    if (state.destination === "fonttbl" || state.destination === "fname" || state.destination === "falt") {
      return documentCodePage;
    }
    const id = state.font ?? defaultFont;
    if (id === undefined) return documentCodePage;
    const font = fonts.get(id);
    if (font === undefined) return undefined;
    if (font.codePage !== undefined) return font.codePage;
    return font.charset === undefined || font.charset === 1
      ? documentCodePage : rtfCodePageForCharsetV2(font.charset);
  }
  function flush(): void {
    if (run === undefined) return;
    const current = run; run = undefined;
    const merged = new Uint8Array(current.size);
    let offset = 0;
    for (const chunk of current.chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
    const value = current.codePage === undefined ? undefined : decodeRtfBytesV2(merged, current.codePage);
    if (value === undefined) { complete = false; return; }
    append(value, { stream: current.stream, destination: current.destination, annotationFrame: current.annotationFrame,
      hidden: current.hidden, channel: current.branch,
      ...(current.audits === undefined ? {} : { auditStreams: current.audits }) }, current.channel);
  }
  function addBytes(value: Uint8Array, state: State, channel: RtfProjectionChannelV2): void {
    if (value.byteLength === 0) return;
    const cp = codePage(state);
    if (run !== undefined && (run.stream !== state.stream || run.codePage !== cp ||
        run.hidden !== state.hidden || run.channel !== channel || run.branch !== state.channel ||
        run.audits !== state.auditStreams)) flush();
    run ??= { chunks: [], size: 0, codePage: cp, stream: state.stream, hidden: state.hidden, channel,
      destination: state.destination, annotationFrame: state.annotationFrame, branch: state.channel,
      ...(state.auditStreams === undefined ? {} : { audits: state.auditStreams }) };
    run.chunks.push(value); run.size += value.byteLength;
  }
  function saveFont(font: Font): void {
    if (font.terminated || fonts.has(font.id) || fonts.size >= 1024) { complete = false; return; }
    font.terminated = true;
    fonts.set(font.id, { ...font });
  }
  function textBytes(value: Uint8Array, state: State): void {
    state.prefix = false;
    if (state.destination === "body" && value.byteLength > 0) bodySeen = true;
    if (state.destination === "fonttbl") {
      for (const byte of value) if (byte === 59 && state.definition !== undefined && !state.definition.terminated) saveFont(state.definition);
    }
    const count = Math.min(skip, value.byteLength);
    addBytes(value.subarray(0, count), state, "legacy");
    skip -= count;
    addBytes(value.subarray(count), state, "both");
  }
  function textValue(value: string, state: State): void {
    flush(); state.prefix = false;
    if (skip > 0) { skip--; append(value, state, "legacy"); }
    else append(value, state);
  }
  function setDestination(state: State, destination: string): void {
    if (!state.prefix) complete = false;
    flush();
    const prefix = state.prefix;
    const starred = state.starred;
    state.destination = destination;
    if (/^(?:footnote|annotation|header[flr]?|footer[flr]?)$/.test(destination)) {
      // Microsoft readers start these destinations from default character
      // formatting, rather than inheriting the preceding body font/code page.
      if (defaultFont === undefined) delete state.font; else state.font = defaultFont;
      delete state.explicitCodePage; state.hidden = false;
    }
    state.stream = output.createStream(destination);
    if (!annotations.destination(state.annotationFrame, destination, state.stream, prefix, starred)) complete = false;
    state.prefix = false; state.starred = false;
  }

  try {
    for (const token of tokenizeRtfPrivacyV2(bytes)) {
      if (token.kind === "group-open") {
        skip = 0;
        const parent = stack.at(-1);
        const annotationFrame = annotations.open(parent?.annotationFrame);
        const state: State = parent === undefined
          ? { stream: rootStream, destination: "body", prefix: true, starred: false, hidden: false,
              annotationFrame, uc: 1, channel: "both" }
          : { ...parent, annotationFrame, prefix: true, starred: false };
        delete state.uprChildren; delete state.uprRole; delete state.udSeen;
        if (parent?.uprChildren !== undefined) {
          parent.uprChildren++;
          state.uprRole = parent.uprChildren === 1 ? "legacy" : "modern";
          if (parent.uprChildren > 2 || (parent.channel !== "both" && parent.channel !== state.uprRole)) complete = false;
          state.channel = state.uprRole;
          state.auditStreams = [...(parent.auditStreams ?? []), output.createStream("upr-branch")];
        }
        stack.push(state);
        continue;
      }
      const state = stack.at(-1);
      if (state === undefined) { complete = false; break; }
      if (token.kind === "group-close") {
        skip = 0;
        if (!annotations.close(state.annotationFrame)) complete = false;
        if (state.uprChildren !== undefined && state.uprChildren !== 2) complete = false;
        if (state.uprRole === "modern" && !state.udSeen) complete = false;
        if (state.definition?.depth === stack.length && !state.definition.terminated) complete = false;
        stack.pop();
        continue;
      }
      if (token.kind === "text") { textBytes(token.bytes, state); continue; }
      if (token.kind === "hex") { textBytes(Uint8Array.of(token.byte), state); continue; }
      if (token.kind === "binary") {
        flush(); complete = false; continue;
      }
      if (token.kind === "symbol") {
        if (token.symbol === "*" && skip > 0) {
          skip--; flush(); complete = false; state.prefix = false; continue;
        }
        if (token.symbol === "*") {
          if (!state.prefix || state.starred) complete = false;
          if (!annotations.star(state.annotationFrame)) complete = false;
          state.starred = true; continue;
        }
        const value = RTF_TEXT_SYMBOLS_V2.get(token.symbol);
        if (value === undefined) {
          complete = false; state.prefix = false;
          if (skip > 0) skip--;
        }
        else textValue(value, state);
        continue;
      }
      if (token.kind !== "control") { complete = false; continue; }
      const { word, parameter } = token;
      if (skip > 0) {
        // Legacy fallback control words count as one character; encoding/state
        // changes here cannot be represented by one shared decoder state.
        skip--; flush(); complete = false; continue;
      }
      if (state.destination === "atntime" && !ANNOTATION_TIME_FIELDS_V2.has(word)) {
        complete = false; state.prefix = false; continue;
      }
      if (word === "ud") {
        if (!state.prefix || !state.starred || state.uprRole !== "modern") complete = false;
        state.udSeen = true; state.prefix = false; state.starred = false;
      } else if (word === "upr") {
        if (!state.prefix || parameter !== undefined) complete = false;
        state.uprChildren = 0; state.prefix = false;
      } else if (word === "field") {
        if (!state.prefix) complete = false;
        if (!annotations.control(word, state.annotationFrame)) complete = false;
        const field: Field = { instructions: 0, results: 0 };
        fields.push(field); state.field = field; state.prefix = false;
      } else if (word === "fldinst") {
        if (!state.prefix || state.field === undefined) complete = false;
        if (state.field !== undefined) state.field.instructions++;
        setDestination(state, "fldinst");
      } else if (word === "fldrslt") {
        if (!state.prefix || state.field === undefined || state.starred) complete = false;
        if (state.field !== undefined) state.field.results++;
        state.prefix = false;
      } else if (RTF_METADATA_DESTINATIONS_V2.has(word)) {
        if (word === "fonttbl" && bodySeen) complete = false;
        setDestination(state, word);
        if (word === "atnref" && parameter !== undefined) append(String(parameter), state, "both", false);
      } else if (state.starred) {
        setDestination(state, "unknown"); complete = false;
      } else if (word === "rtf") {
        if (stack.length !== 1 || !state.prefix || parameter !== 1) complete = false;
        state.prefix = false;
      } else if (word === "ansi" || word === "mac" || word === "pc" || word === "pca" || word === "ansicpg") {
        flush();
        if (stack.length !== 1 || bodySeen) complete = false;
        documentCodePage = word === "ansi" ? 1252 : word === "mac" ? 10000 : word === "pc" ? 437 :
          word === "pca" ? 850 : parameter ?? -1;
        if (decodeRtfBytesV2(new Uint8Array(), documentCodePage) === undefined) complete = false;
        state.prefix = false;
      } else if (word === "deff") {
        if (stack.length !== 1 || bodySeen || parameter === undefined || parameter < 0 || parameter > 32767) complete = false;
        else defaultFont = parameter;
        state.prefix = false;
      } else if (word === "f") {
        flush();
        if (parameter === undefined || parameter < 0 || parameter > 32767) complete = false;
        else if (state.destination === "fonttbl") {
          if (state.definition !== undefined && !state.definition.terminated) complete = false;
          state.definition = { id: parameter, terminated: false, depth: stack.length };
        } else state.font = parameter;
        state.prefix = false;
      } else if (word === "fcharset" || word === "cpg") {
        flush();
        if (state.destination === "fonttbl" && state.definition !== undefined && !state.definition.terminated) {
          if (parameter === undefined || parameter < 0 || parameter > 65535) complete = false;
          else if (word === "fcharset") state.definition.charset = parameter;
          else state.definition.codePage = parameter;
        } else if (word === "cpg" && state.destination === "fldinst" && parameter !== undefined) state.explicitCodePage = parameter;
        else complete = false;
        state.prefix = false;
      } else if (word === "plain") {
        flush(); if (defaultFont === undefined) delete state.font; else state.font = defaultFont;
        delete state.explicitCodePage; state.hidden = false; state.prefix = false;
      } else if (word === "v") {
        state.hidden = parameter !== 0; state.prefix = false;
      } else if (word === "uc") {
        if (parameter === undefined || parameter < 0 || parameter > 32767) complete = false;
        else state.uc = parameter;
        state.prefix = false;
      } else if (word === "u") {
        flush();
        if (parameter === undefined || parameter < -32768 || parameter > 65535) complete = false;
        else { append(String.fromCharCode(parameter & 0xffff), state, "modern"); skip = state.uc; }
        state.prefix = false;
      } else if (word === "chatn" || word === "chftn") {
        if (!annotations.control(word, state.annotationFrame)) complete = false;
        state.prefix = false;
      } else if (RTF_TEXT_CONTROLS_V2.has(word)) {
        if (!annotations.control(word, state.annotationFrame)) complete = false;
        textValue(RTF_TEXT_CONTROLS_V2.get(word)!, state);
      } else if (word === "ftnalt") {
        if (state.destination !== "footnote") complete = false;
        state.prefix = false;
      } else if (state.destination === "atntime" && ANNOTATION_TIME_FIELDS_V2.has(word)) {
        if (!annotations.timeField(state.annotationFrame, word, parameter)) complete = false;
        append(`${word}=${parameter ?? ""} `, state, "both", false);
        state.prefix = false;
      } else if (state.destination === "atntime") {
        complete = false;
        state.prefix = false;
      } else if (word === "s" || word === "cs" || word === "ds" || word === "ts") {
        if (state.destination !== "stylesheet") complete = false;
        state.prefix = false;
      } else if (RTF_FORMATTING_CONTROLS_V2.has(word)) {
        state.prefix = false;
      } else {
        flush(); complete = false; state.prefix = false;
      }
    }
    flush();
  } catch {
    complete = false;
    try { flush(); } catch { /* Only bounded prefix projections remain available. */ }
  }
  if (stack.length !== 0 || fields.some((field) => field.instructions !== 1 || field.results !== 1)) complete = false;
  const projectedStreams = output.snapshot();
  if (!annotations.finalize(projectedStreams)) complete = false;

  const textValues = new Set<string>();
  const linkValues = new Set<string>();
  let linksComplete = complete;
  for (const stream of projectedStreams) {
    for (const value of stream.values) {
      if (!scalarText(value)) complete = false;
      textValues.add(value);
      if (stream.role === "fldinst" && !isStaticRtfHyperlinkV2(value)) { complete = false; linksComplete = false; }
      const candidates: string[] = [];
      if (stream.role === "fldinst" || stream.role === "hlinkbase") candidates.push(value);
      else {
        const found = collectRtfUrlCandidatesV2(value);
        if (!found.complete) linksComplete = false;
        candidates.push(...found.values);
      }
      for (const candidate of candidates) {
        linkValues.add(candidate);
        const projection = projectUrlTextV2(candidate);
        if (!projection.complete) linksComplete = false;
        for (const decoded of projection.values) {
          if (!output.reserveProjection(decoded)) { linksComplete = false; break; }
          linkValues.add(decoded);
        }
      }
    }
  }
  return { textComplete: complete, linksComplete: linksComplete && complete,
    textValues: [...textValues], linkValues: [...linkValues] };
}
