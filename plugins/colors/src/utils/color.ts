import { Colord } from "colord";

export function colordToHsvString(color: Colord) {
  let hsv = color.toHsv();
  return `hsv(${hsv.h.toFixed(0)},${hsv.s.toFixed(0)}%,${hsv.v.toFixed(0)}%)`;
}
export type ColorFormat =
  | "hex"
  | "hsv"
  | "hsv/hsb"
  | "hsl"
  | "rgb"
  | "hwb"
  | "cmyk"
  | "lab"
  | "lch"
  | "xyz";
export interface ColorToStringOptions {
  format: ColorFormat;
  removeHash?: boolean;
}

export function colordToString(color: Colord, options?: ColorToStringOptions): string {
  const { format = "hex", removeHash = false } = options || {};
  switch (format) {
    case "hsl":
      return color.toHslString();
    case "hsv/hsb":
    case "hsv":
      return colordToHsvString(color);
    case "hex":
      let hex = removeHash ? color.toHex().substring(1) : color.toHex();
      return hex;
    case "rgb":
      return color.toRgbString();
    case "hwb":
      return color.toHwbString();
    case "cmyk":
      return color.toCmykString();
    case "lab":
      const lab = color.toLab();
      return `lab(${lab.l.toFixed(0)} ${lab.a.toFixed(0)} ${lab.b.toFixed(0)})`;
    case "lch":
      const lch = color.toLch();
      return `lch(${lch.l.toFixed(0)} ${lch.c.toFixed(0)} ${lch.h.toFixed(0)})`;
    case "xyz":
      const xyz = color.toXyz();
      return `xyz(${xyz.x.toFixed(2)} ${xyz.y.toFixed(2)} ${xyz.z.toFixed(2)})`;
  }
}
