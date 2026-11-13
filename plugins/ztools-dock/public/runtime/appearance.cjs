'use strict';
const os = require('node:os');
function supportsMaterials(platform = process.platform, release = os.release()) {
  const [major, minor, build] = release.split('.').map(Number);
  return platform === 'win32' && major === 10 && minor === 0 && build >= 22621;
}
// Clip native DWM painting as well as hit testing, including rounded corners.
function roundedRegions(rects, radius = 7) {
  return rects.flatMap(({ x, y, width, height }) => {
    const r = Math.min(radius, Math.floor(width / 2), Math.floor(height / 2));
    const rows = [];
    for (let row = 0; row < r; row++) {
      const inset = Math.ceil(r - Math.sqrt(r * r - (r - row - 0.5) ** 2));
      rows.push({ x: x + inset, y: y + row, width: width - 2 * inset, height: 1 }, { x: x + inset, y: y + height - row - 1, width: width - 2 * inset, height: 1 });
    }
    if (height > 2 * r) rows.push({ x, y: y + r, width, height: height - 2 * r });
    return rows;
  });
}
module.exports = { supportsMaterials, roundedRegions };
