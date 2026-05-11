import { Colord } from "colord";

export function colordToHsvString(color: Colord) {
  let hsv = color.toHsv();
  return `hsv(${hsv.h.toFixed(0)},${hsv.s.toFixed(0)}%,${hsv.v.toFixed(0)}%)`;
}
