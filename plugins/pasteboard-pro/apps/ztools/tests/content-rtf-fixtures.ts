export function makeRtf(source: string): Uint8Array {
  return new TextEncoder().encode(source);
}

export function rtf(source: string): string {
  return source.replaceAll("|", String.fromCharCode(92));
}

export function rtfHexAscii(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) =>
    String.fromCharCode(92) + "'" + byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function rtfUnicode(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    output += String.fromCharCode(92) + "u" + (unit > 32767 ? unit - 65536 : unit) + "?";
  }
  return output;
}

export function rtfUnicodeWithFallback(value: string, fallbackCount: number): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    output += String.fromCharCode(92) + "u" + (unit > 32767 ? unit - 65536 : unit) + "?".repeat(fallbackCount);
  }
  return output;
}


// macOS AppKit fixture generated with NSAttributedString(string: "RTF native 测试").data(from:documentAttributes: .rtf).
export const NATIVE_MACOS_RTF = String.raw`{\rtf1\ansi\ansicpg1252\cocoartf2907
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\pard\tx560\tx1120\tx1680\tx2240\tx2800\tx3360\tx3920\tx4480\tx5040\tx5600\tx6160\tx6720\pardirnatural\partightenfactor0

\f0\fs24 \cf0 RTF native \uc0\u27979 \u35797 }`;
