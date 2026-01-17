function getGradientColor(colors, positions, currentPosition) {
  if (currentPosition <= 0) {
    return colors[0];
  }
  if (currentPosition >= 1) {
    return colors[colors.length - 1];
  }

  for (let i = 0; i < positions.length - 1; i++) {
    if (currentPosition >= positions[i] && currentPosition <= positions[i + 1]) {
      const color1 = colors[i];
      const color2 = colors[i + 1];
      const pos1 = positions[i];
      const pos2 = positions[i + 1];

      const ratio = (currentPosition - pos1) / (pos2 - pos1);

      const [r1, g1, b1] = hexToRgb(color1);
      const [r2, g2, b2] = hexToRgb(color2);

      const r = Math.round(interpolate(r1, r2, ratio));
      const g = Math.round(interpolate(g1, g2, ratio));
      const b = Math.round(interpolate(b1, b2, ratio));

      return rgbToHex(r, g, b);
    }
  }
}

function hexToRgb(hex) {
  const r = parseInt(hex.substring(1, 3), 16);
  const g = parseInt(hex.substring(3, 5), 16);
  const b = parseInt(hex.substring(5, 7), 16);
  return [r, g, b];
}

function rgbToHex(r, g, b) {
  const toHex = (x) => {
    const hex = x.toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function interpolate(a, b, t) {
  return a + (b - a) * t;
}
