import PathKitInit from 'pathkit-wasm/bin/pathkit.js'
import wasmUrl from 'pathkit-wasm/bin/pathkit.wasm?url'

export type PathKitPath = {
  addPath(path: PathKitPath, ...matrix: any[]): PathKitPath
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, ccw?: boolean): PathKitPath
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): PathKitPath
  close(): PathKitPath
  closePath(): PathKitPath
  computeTightBounds(): PathKitBounds
  copy(): PathKitPath
  cubicTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): PathKitPath
  delete(): void
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, startAngle: number, endAngle: number, ccw?: boolean): PathKitPath
  getBounds(): PathKitBounds
  getFillTypeString(): CanvasFillRule
  lineTo(x: number, y: number): PathKitPath
  moveTo(x: number, y: number): PathKitPath
  op(path: PathKitPath, operation: unknown): PathKitPath | null
  quadTo(cpx: number, cpy: number, x: number, y: number): PathKitPath
  rect(x: number, y: number, width: number, height: number): PathKitPath
  setFillType(fillType: unknown): void
  simplify(): PathKitPath | null
  stroke(options: {
    width: number
    miter_limit?: number
    cap?: unknown
    join?: unknown
  }): PathKitPath | null
  toSVGString(): string
  transform(matrix: number[]): PathKitPath | null
}

export type PathKitBounds = {
  fLeft: number
  fTop: number
  fRight: number
  fBottom: number
}

export type PathKitApi = {
  NewPath(): PathKitPath
  FromSVGString(path: string): PathKitPath | null
  PathOp: {
    DIFFERENCE: unknown
    INTERSECT: unknown
    UNION: unknown
    XOR: unknown
    REVERSE_DIFFERENCE: unknown
  }
  StrokeCap: {
    BUTT: unknown
    ROUND: unknown
    SQUARE: unknown
  }
  StrokeJoin: {
    MITER: unknown
    ROUND: unknown
    BEVEL: unknown
  }
  FillType: {
    WINDING: unknown
    EVENODD: unknown
  }
}

type PathKitInitOptions = {
  locateFile?: (file: string) => string
}

type PathKitInitFn = (options?: PathKitInitOptions) => Promise<PathKitApi>

let pathKitPromise: Promise<PathKitApi> | null = null
let pathKitInstance: PathKitApi | null = null

export function peekPathKit() {
  return pathKitInstance
}

export function getPathKit(): Promise<PathKitApi> {
  if (!pathKitPromise) {
    pathKitPromise = (PathKitInit as PathKitInitFn)({
      locateFile: () => wasmUrl
    }).then((api) => {
      pathKitInstance = api
      return api
    })
  }
  return pathKitPromise
}
