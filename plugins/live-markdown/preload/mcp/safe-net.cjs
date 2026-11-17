"use strict";

const net = require("node:net");

function isPublicAddress(address) {
  const kind = net.isIP(address);
  if (kind === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0) ||
      (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)));
  }
  if (kind !== 6) return false;
  const dottedMapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dottedMapped) return isPublicAddress(dottedMapped[1]);
  const normalized = expandIpv6(address);
  if (!normalized) return false;
  if (normalized.slice(0, 4) === "0000") {
    const tail = normalized.slice(-8);
    if (normalized.slice(0, 24) === "00000000000000000000ffff") {
      const ipv4 = `${parseInt(tail.slice(0, 2), 16)}.${parseInt(tail.slice(2, 4), 16)}.${parseInt(tail.slice(4, 6), 16)}.${parseInt(tail.slice(6, 8), 16)}`;
      return isPublicAddress(ipv4);
    }
  }
  const first = parseInt(normalized.slice(0, 4), 16);
  const second = parseInt(normalized.slice(4, 8), 16);
  return first >= 0x2000 && first <= 0x3fff && !(first === 0x2001 && second === 0x0db8);
}

function expandIpv6(address) {
  const lower = address.toLowerCase();
  const halves = lower.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  return [...left, ...Array(missing).fill("0"), ...right].map((part) => part.padStart(4, "0")).join("");
}

module.exports = { isPublicAddress };
