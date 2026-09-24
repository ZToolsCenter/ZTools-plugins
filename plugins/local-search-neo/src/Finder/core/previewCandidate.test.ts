/// <reference types="node" />

import { formatBytes } from "./formatters";
import {
  getArchiveTreePreviewBlockedReason,
  getCodePreviewLanguage,
  isArchiveTreePreviewCandidate,
  isAudioPreviewCandidate,
  isCodePreviewCandidate,
  isImagePreviewCandidate,
  isMarkdownPreviewCandidate,
  isPdfPreviewCandidate,
  isTextPreviewCandidate,
  isVideoPreviewCandidate,
} from "./previewCandidate";

declare const test: (name: string, fn: () => void) => void;
declare const assert: typeof import("node:assert/strict");

test("preview candidate helpers detect supported file types", () => {
  assert.equal(isTextPreviewCandidate({ name: "main.log", size: 1024 }), true);
  assert.equal(isTextPreviewCandidate({ name: "notes.md", size: 1024 }), true);
  assert.equal(isTextPreviewCandidate({ name: "image.png", size: 1024 }), false);
  assert.equal(isTextPreviewCandidate({ name: "big.txt", size: 30 * 1024 * 1024 }), false);
  assert.equal(isTextPreviewCandidate({ name: "folder", isDirectory: true }), false);

  assert.equal(isImagePreviewCandidate({ name: "photo.webp" }), true);
  assert.equal(isImagePreviewCandidate({ name: "movie.mp4" }), false);
  assert.equal(isImagePreviewCandidate({ name: "Pictures", isDirectory: true }), false);

  assert.equal(isVideoPreviewCandidate({ name: "movie.mp4" }), true);
  assert.equal(isVideoPreviewCandidate({ name: "clip.webm" }), true);
  assert.equal(isVideoPreviewCandidate({ name: "sound.ogg" }), false);
  assert.equal(isVideoPreviewCandidate({ name: "photo.jpg" }), false);
  assert.equal(isVideoPreviewCandidate({ name: "Videos", isDirectory: true }), false);

  assert.equal(isAudioPreviewCandidate({ name: "sound.mp3" }), true);
  assert.equal(isAudioPreviewCandidate({ name: "voice.ogg" }), true);
  assert.equal(isAudioPreviewCandidate({ name: "track.flac" }), true);
  assert.equal(isAudioPreviewCandidate({ name: "movie.mp4" }), false);
  assert.equal(isAudioPreviewCandidate({ name: "Music", isDirectory: true }), false);

  assert.equal(isPdfPreviewCandidate({ name: "document.pdf" }), true);
  assert.equal(isPdfPreviewCandidate({ name: "PDFs", isDirectory: true }), false);

  assert.equal(isArchiveTreePreviewCandidate({ name: "archive.zip" }), true);
  assert.equal(isArchiveTreePreviewCandidate({ name: "source.tar" }), true);
  assert.equal(isArchiveTreePreviewCandidate({ name: "source.tar.gz" }), true);
  assert.equal(isArchiveTreePreviewCandidate({ name: "source.tgz" }), true);
  assert.equal(
    isArchiveTreePreviewCandidate({ name: "source.tar", size: 100 * 1024 * 1024 }),
    true,
  );
  assert.equal(
    isArchiveTreePreviewCandidate({ name: "source.tar", size: 100 * 1024 * 1024 + 1 }),
    false,
  );
  assert.equal(
    getArchiveTreePreviewBlockedReason({ name: "source.tar", size: 100 * 1024 * 1024 + 1 }),
    "压缩包超过 100 MB，不提供预览",
  );
  assert.equal(
    isArchiveTreePreviewCandidate({ name: "source.tar.gz", size: 100 * 1024 * 1024 + 1 }),
    false,
  );
  assert.equal(
    isArchiveTreePreviewCandidate({ name: "source.tgz", size: 100 * 1024 * 1024 + 1 }),
    false,
  );
  assert.equal(
    isArchiveTreePreviewCandidate({ name: "single-file.gz", size: 100 * 1024 * 1024 + 1 }),
    true,
  );
  assert.equal(
    getArchiveTreePreviewBlockedReason({
      name: "single-file.gz",
      size: 100 * 1024 * 1024 + 1,
    }),
    undefined,
  );
  assert.equal(isArchiveTreePreviewCandidate({ name: "archive.rar" }), false);
  assert.equal(isArchiveTreePreviewCandidate({ name: "Archives", isDirectory: true }), false);

  assert.equal(isMarkdownPreviewCandidate({ name: "README.md" }), true);
  assert.equal(isMarkdownPreviewCandidate({ name: "notes.markdown" }), true);
  assert.equal(isMarkdownPreviewCandidate({ name: "script.ts" }), false);

  assert.equal(isCodePreviewCandidate({ name: "script.ts" }), true);
  assert.equal(isCodePreviewCandidate({ name: "Component.vue" }), true);
  assert.equal(isCodePreviewCandidate({ name: "README.md" }), false);
  assert.equal(getCodePreviewLanguage({ name: "script.ts" }), "typescript");
});

test("formatBytes returns compact human-readable values", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(-10), "0 B");
  assert.equal(formatBytes(Number.NaN), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5 MB");
});
