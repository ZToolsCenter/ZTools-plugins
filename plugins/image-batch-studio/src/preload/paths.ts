import path from "node:path";
import fs from "node:fs";
import type { ImageFormat, OutputPathInput } from "../shared/types";

export function normalizeExtension(format: ImageFormat | string): string {
  const normalized = format.toLowerCase().replace(/^\./, "");
  if (normalized === "jpeg") return "jpg";
  if (normalized === "tif") return "tiff";
  return normalized;
}

function sanitizeFilename(filename: string): string {
  const sanitized = filename
    .replace(/[\\/]+/g, "-")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/^\.+/, "");
  return sanitized || "output";
}

export function buildOutputPath(input: OutputPathInput): string {
  const parsed = path.parse(input.inputPath);
  const extension = normalizeExtension(input.targetFormat);
  const replacements: Record<string, string> = {
    name: parsed.name,
    ext: extension,
    index: String(input.index),
    width: input.width ? String(input.width) : "",
    height: input.height ? String(input.height) : "",
    date: new Date().toISOString().slice(0, 10).replace(/-/g, "")
  };

  let filename = input.namingPattern || "{name}.{ext}";
  for (const [token, value] of Object.entries(replacements)) {
    filename = filename.replaceAll(`{${token}}`, value);
  }
  if (!path.extname(filename)) {
    filename = `${filename}.${extension}`;
  }
  filename = sanitizeFilename(filename);

  const existingPaths = input.existingPaths ?? new Set<string>();
  const candidate = path.join(input.outputDirectory, filename);
  const collides = (candidatePath: string) => existingPaths.has(candidatePath) || (!input.overwrite && fs.existsSync(candidatePath));

  if (!collides(candidate)) {
    existingPaths.add(candidate);
    return candidate;
  }

  const name = path.basename(filename, path.extname(filename));
  const ext = path.extname(filename);
  for (let suffix = 1; suffix < 10000; suffix += 1) {
    const next = path.join(input.outputDirectory, `${name}-${suffix}${ext}`);
    if (!collides(next)) {
      existingPaths.add(next);
      return next;
    }
  }

  throw new Error(`Unable to build a unique output path for ${input.inputPath}`);
}
