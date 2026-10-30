type AnnotationPartV2 = "atnid" | "atnauthor" | "atntime" | "atndate" | "atnparent";
type AnnotationTimeFieldV2 = "yr" | "mo" | "dy" | "hr" | "min" | "sec";
type PhaseV2 = "idle" | "author" | "marker" | "body";

export type RtfAnnotationFrameV2 = {
  parent?: RtfAnnotationFrameV2;
  destination: string;
  stream?: number;
  starred: boolean;
  prefix: boolean;
  part?: AnnotationPartV2;
  timeFields?: Partial<Record<AnnotationTimeFieldV2, number>>;
  timeLastOrder?: number;
  partValid: boolean;
  phase: PhaseV2;
  structureValid: boolean;
  atnIdStream?: number;
  atnAuthorStream?: number;
  atnTimeStream?: number;
  atnParentStream?: number;
  bodyTextUnits: number;
  annotationRoot: boolean;
  annotationOwner?: RtfAnnotationFrameV2;
  dateSeen: boolean;
  parentSeen: boolean;
  timeSeen: boolean;
  bodySeen: boolean;
  closed: boolean;
};

type ProjectionStreamV2 = Readonly<{ role: string; values: readonly string[] }>;
const MAX_ANNOTATIONS_V2 = 4096;
const MAX_ANNOTATION_ID_UNITS_V2 = 256;
const MAX_ANNOTATION_PARTS_V2 = MAX_ANNOTATIONS_V2 * 5;
const MAX_METADATA_UNITS_V2 = 1024 * 1024;
const PARTS_V2 = new Set<string>(["atnid", "atnauthor", "atntime", "atndate", "atnparent"]);
const DETACHED_DESTINATIONS_V2 = /^(?:footnote|annotation|header(?:[flr])?|footer(?:[flr])?)$/;
const STRUCTURAL_CONTROLS_V2 = new Set(["par", "line", "cell", "row", "nestcell", "nestrow", "sect", "page"]);

function scalar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit === 0 || unit === 0xfffd) return false;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(++i);
      if (low < 0xdc00 || low > 0xdfff) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

function semanticValue(streams: readonly ProjectionStreamV2[], index: number | undefined): string | undefined {
  if (index === undefined) return undefined;
  const values = streams[index]?.values;
  if (!values || values.length === 0 || values.some((value) => value.length > 4096 || !scalar(value))) return undefined;
  return values.find((value) => value.length > 0) ?? values[0];
}

function streamHasText(streams: readonly ProjectionStreamV2[], index: number | undefined): boolean {
  if (index === undefined) return false;
  const values = streams[index]?.values;
  return Boolean(values?.length && values.every(scalar) && values.some((value) => value.trim().length > 0));
}

/** Tracks annotation associations while leaving each destination in the privacy projection. */
export class RtfAnnotationTrackerV2 {
  private readonly roots: RtfAnnotationFrameV2[] = [];
  private readonly parts: RtfAnnotationFrameV2[] = [];
  private metadataUnits = 0;
  private overflow = false;

  open(parent?: RtfAnnotationFrameV2): RtfAnnotationFrameV2 {
    return {
      ...(parent === undefined ? {} : { parent }),
      destination: parent?.destination ?? "body",
      starred: false,
      prefix: true,
      partValid: true,
      phase: "idle",
      structureValid: true,
      bodyTextUnits: 0,
      annotationRoot: false,
      dateSeen: false,
      parentSeen: false,
      timeSeen: false,
      bodySeen: false,
      closed: false,
    };
  }

  star(frame: RtfAnnotationFrameV2): boolean {
    if (!frame.prefix || frame.starred) return false;
    frame.starred = true;
    return true;
  }

  destination(frame: RtfAnnotationFrameV2, word: string, stream: number,
    prefix: boolean, starred: boolean): boolean {
    let valid = true;
    const parent = frame.parent;
    if (word === "atnref") {
      // Annotation bookmark/range references are deliberately not interpreted.
      // Keep their text stream visible to the caller, but fail closed.
      frame.destination = word;
      frame.stream = stream;
      frame.prefix = false;
      frame.starred = false;
      frame.partValid = false;
      return false;
    }
    if (PARTS_V2.has(word)) {
      const part = word as AnnotationPartV2;
      frame.part = part;
      frame.stream = stream;
      frame.destination = part;
      if (part === "atntime") frame.timeFields = {};
      frame.prefix = false;
      frame.starred = false;
      if (this.parts.length >= MAX_ANNOTATION_PARTS_V2) {
        this.overflow = true;
        valid = false;
      } else this.parts.push(frame);

      if (!prefix || !starred || parent === undefined) valid = false;
      else if (part === "atnid" || part === "atnauthor" || part === "atntime") {
        if (parent.destination !== "body" || this.insideDetachedContext(parent) || this.insideAnnotation(parent)) valid = false;
        else if (part === "atnid") {
          if (parent.phase !== "idle") valid = false;
          else parent.phase = "author";
        } else if (part === "atnauthor") {
          if (parent.phase !== "author") valid = false;
          else parent.phase = "marker";
        } else if (parent.phase !== "marker" || parent.timeSeen) valid = false;
        else parent.timeSeen = true;
      } else {
        const annotation = parent.annotationRoot ? parent : undefined;
        if (annotation === undefined || !prefix || !starred || annotation.bodySeen) valid = false;
        else if (part === "atndate") {
          if (annotation.dateSeen || annotation.atnParentStream !== undefined) valid = false;
          else annotation.dateSeen = true;
        } else {
          if (annotation.parentSeen) valid = false;
          else { annotation.parentSeen = true; annotation.atnParentStream = stream; }
        }
      }
      frame.partValid = valid;
      return valid;
    }

    if (word === "annotation") {
      frame.destination = word;
      frame.stream = stream;
      frame.prefix = false;
      frame.starred = false;
      const anchored = parent !== undefined && parent.destination === "body" && parent.phase === "body" &&
        !this.insideDetachedContext(parent) && !this.insideAnnotation(parent);
      if (!prefix || !starred || !anchored || this.roots.length >= MAX_ANNOTATIONS_V2) {
        valid = false;
        if (this.roots.length >= MAX_ANNOTATIONS_V2) this.overflow = true;
      }
      frame.annotationRoot = true;
      if (parent !== undefined) {
        frame.annotationOwner = parent;
        if (parent.atnIdStream !== undefined) frame.atnIdStream = parent.atnIdStream;
        if (parent.atnAuthorStream !== undefined) frame.atnAuthorStream = parent.atnAuthorStream;
        if (parent.atnTimeStream !== undefined) frame.atnTimeStream = parent.atnTimeStream;
        parent.phase = "idle";
        parent.timeSeen = false;
        delete parent.atnIdStream;
        delete parent.atnAuthorStream;
        delete parent.atnTimeStream;
      }
      if (this.roots.length < MAX_ANNOTATIONS_V2) this.roots.push(frame);
      frame.partValid = valid;
      return valid;
    }

    if (word === "footnote") {
      frame.destination = word;
      if (this.insideDetachedContext(parent) || this.insideAnnotation(parent) || !this.noPendingBody(parent)) valid = false;
      frame.partValid = valid;
      return valid;
    }

    if (!this.noPendingBody(parent)) valid = false;
    frame.destination = word;
    frame.prefix = false;
    frame.starred = false;
    return valid;
  }

  control(word: string, frame: RtfAnnotationFrameV2): boolean {
    frame.prefix = false;
    if (word === "chatn") {
      if (this.insideAnnotation(frame)) return true;
      if (frame.destination !== "body" || frame.phase !== "marker" ||
          this.insideDetachedContext(frame)) return false;
      frame.phase = "body";
      return true;
    }
    if (word === "chftn") {
      return !this.insideAnnotation(frame) && !this.insideHeaderFooter(frame) && this.noPendingBody(frame);
    }
    if (word === "field") {
      return this.noPendingBody(frame);
    }
    if (STRUCTURAL_CONTROLS_V2.has(word)) {
      let valid = true;
      for (let current: RtfAnnotationFrameV2 | undefined = frame; current; current = current.parent) {
        if (current.destination === "body" && current.phase !== "idle") {
          current.structureValid = false;
          valid = false;
        }
      }
      return valid || this.insideAnnotation(frame) || this.insideDestination(frame, "footnote");
    }
    return true;
  }

  timeField(frame: RtfAnnotationFrameV2, word: string, parameter: number | undefined): boolean {
    if (frame.part !== "atntime" || frame.destination !== "atntime" || parameter === undefined) {
      const part = this.partAncestor(frame, "atntime");
      if (part) part.partValid = false;
      return false;
    }
    const field = word as AnnotationTimeFieldV2;
    const order = ["yr", "mo", "dy", "hr", "min", "sec"].indexOf(field);
    const range: Record<AnnotationTimeFieldV2, readonly [number, number]> = {
      yr: [0, 32767], mo: [1, 12], dy: [1, 31], hr: [0, 23], min: [0, 59], sec: [0, 59],
    };
    const [minimum, maximum] = range[field];
    if (!Number.isInteger(parameter) || parameter < minimum || parameter > maximum ||
        frame.timeFields?.[field] !== undefined || order < 0 ||
        (frame.timeLastOrder !== undefined && order <= frame.timeLastOrder)) {
      frame.partValid = false;
      return false;
    }
    frame.timeFields ??= {};
    frame.timeFields[field] = parameter;
    frame.timeLastOrder = order;
    return true;
  }

  noteText(frame: RtfAnnotationFrameV2, value: string): void {
    if (!value) return;
    const metadata = this.hasPartAncestor(frame);
    if (metadata) this.metadataUnits += value.length;
    const timePart = this.partAncestor(frame, "atntime");
    if (timePart) timePart.partValid = false;
    if (!metadata) {
      for (let current: RtfAnnotationFrameV2 | undefined = frame; current; current = current.parent) {
        if (current.destination === "body" && current.phase !== "idle") current.structureValid = false;
      }
    }
    const annotation = this.annotationRootOf(frame);
    if (annotation && !metadata) {
      annotation.bodyTextUnits += value.length;
      annotation.bodySeen = true;
    }
  }

  close(frame: RtfAnnotationFrameV2): boolean {
    if (frame.closed) return false;
    frame.closed = true;
    let valid = frame.partValid;
    const parent = frame.parent;
    if (frame.part) {
      if (!parent || frame.stream === undefined) valid = false;
      else if (frame.part === "atnid") parent.atnIdStream = frame.stream;
      else if (frame.part === "atnauthor") parent.atnAuthorStream = frame.stream;
      else if (frame.part === "atntime") parent.atnTimeStream = frame.stream;
    }
    if (frame.annotationRoot) {
      if (!frame.annotationOwner) valid = false;
      frame.partValid = valid;
    }
    if (frame.destination === "body" && frame.phase !== "idle") valid = false;
    if (!valid) frame.partValid = false;
    return valid;
  }

  finalize(streams: readonly ProjectionStreamV2[]): boolean {
    let valid = !this.overflow && this.metadataUnits <= MAX_METADATA_UNITS_V2;
    for (const part of this.parts) {
      const value = semanticValue(streams, part.stream);
      let partValid = part.closed && part.partValid && value !== undefined &&
        (value.length > 0 || part.part === "atntime") && value.length <= 4096 && scalar(value);
      if (part.part === "atnid" && (value === undefined || value.length > MAX_ANNOTATION_ID_UNITS_V2)) partValid = false;
      if (part.part === "atntime" && !this.validAnnotationTime(part.timeFields)) partValid = false;
      if (part.part === "atndate" && (value === undefined || !/^\d{1,10}$/.test(value))) partValid = false;
      if (part.part === "atnparent" && (value === undefined || value.length > MAX_ANNOTATION_ID_UNITS_V2)) partValid = false;
      if (!partValid) {
        valid = false;
        if (part.part === "atnid" || part.part === "atnauthor" || part.part === "atntime") {
          if (part.parent) part.parent.structureValid = false;
        } else if (part.parent?.annotationRoot) part.parent.partValid = false;
      }
    }

    const parentValues: Array<string | undefined> = new Array(this.roots.length);
    const parentRecords: Array<number | undefined> = new Array(this.roots.length);
    const baseValid = new Array<boolean>(this.roots.length).fill(false);
    const recordsById = new Map<string, number[]>();
    for (let index = 0; index < this.roots.length; index++) {
      const annotation = this.roots[index]!;
      const owner = annotation.annotationOwner;
      const id = semanticValue(streams, annotation.atnIdStream);
      const author = semanticValue(streams, annotation.atnAuthorStream);
      const bodyHasText = streamHasText(streams, annotation.stream);
      if (!annotation.closed || !annotation.partValid || !owner || id === undefined ||
          id.length > MAX_ANNOTATION_ID_UNITS_V2 || !scalar(id) || author === undefined ||
          author.length > 4096 || !scalar(author)) {
        valid = false;
        continue;
      }
      if (!bodyHasText || annotation.bodyTextUnits === 0 || !owner.structureValid || owner.phase !== "idle") {
        valid = false;
        continue;
      }
      baseValid[index] = true;
      const records = recordsById.get(id) ?? [];
      records.push(index);
      recordsById.set(id, records);
      if (annotation.atnParentStream !== undefined) {
        const parent = semanticValue(streams, annotation.atnParentStream);
        if (!parent || parent.length > MAX_ANNOTATION_ID_UNITS_V2 || !scalar(parent)) valid = false;
        else parentValues[index] = parent;
      }
    }

    for (let index = 0; index < this.roots.length; index++) {
      if (!baseValid[index] || parentValues[index] === undefined) continue;
      const candidates = recordsById.get(parentValues[index]!) ?? [];
      let resolved: number | undefined;
      let matches = 0;
      for (const candidate of candidates) {
        if (candidate === index) continue;
        resolved = candidate;
        matches++;
        if (matches > 1) break;
      }
      if (matches !== 1) valid = false;
      else parentRecords[index] = resolved;
    }

    const visitState = new Uint8Array(this.roots.length);
    for (let start = 0; start < this.roots.length; start++) {
      if (!baseValid[start] || visitState[start] !== 0) continue;
      const path: number[] = [];
      let current: number | undefined = start;
      while (current !== undefined && baseValid[current] && visitState[current] === 0) {
        visitState[current] = 1;
        path.push(current);
        current = parentRecords[current];
      }
      if (current !== undefined && visitState[current] === 1) valid = false;
      for (const record of path) visitState[record] = 2;
    }
    return valid && this.roots.every((root) => root.partValid && root.closed && root.bodyTextUnits > 0);
  }

  private insideDestination(frame: RtfAnnotationFrameV2, destination: string): boolean {
    for (let current: RtfAnnotationFrameV2 | undefined = frame; current; current = current.parent) {
      if (current.destination === destination) return true;
    }
    return false;
  }

  private insideDetachedContext(frame?: RtfAnnotationFrameV2): boolean {
    for (let current = frame; current; current = current.parent) {
      if (DETACHED_DESTINATIONS_V2.test(current.destination)) return true;
    }
    return false;
  }

  private insideHeaderFooter(frame?: RtfAnnotationFrameV2): boolean {
    for (let current = frame; current; current = current.parent) {
      if (/^(?:header|footer)/.test(current.destination)) return true;
    }
    return false;
  }

  private insideAnnotation(frame?: RtfAnnotationFrameV2): boolean {
    for (let current = frame; current; current = current.parent) if (current.annotationRoot) return true;
    return false;
  }

  private annotationRootOf(frame: RtfAnnotationFrameV2): RtfAnnotationFrameV2 | undefined {
    for (let current: RtfAnnotationFrameV2 | undefined = frame; current; current = current.parent) {
      if (current.annotationRoot) return current;
    }
    return undefined;
  }

  private hasPartAncestor(frame: RtfAnnotationFrameV2): boolean {
    for (let current: RtfAnnotationFrameV2 | undefined = frame; current; current = current.parent) {
      if (current.part) return true;
    }
    return false;
  }

  private partAncestor(frame: RtfAnnotationFrameV2, part: AnnotationPartV2): RtfAnnotationFrameV2 | undefined {
    for (let current: RtfAnnotationFrameV2 | undefined = frame; current; current = current.parent) {
      if (current.part === part) return current;
    }
    return undefined;
  }

  private noPendingBody(frame?: RtfAnnotationFrameV2): boolean {
    let valid = true;
    for (let current = frame; current; current = current.parent) {
      if (current.destination === "body" && current.phase !== "idle") {
        current.structureValid = false;
        valid = false;
      }
    }
    return valid;
  }

  private validAnnotationTime(fields: RtfAnnotationFrameV2["timeFields"]): boolean {
    if (!fields) return true;
    if (fields.mo === undefined || fields.dy === undefined) return true;
    const year = fields.yr;
    const daysByMonth = [31, year === undefined || year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0) ? 29 : 28,
      31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return fields.dy <= (daysByMonth[fields.mo - 1] ?? 0);
  }
}
