import { expect, test } from "playwright/test";
import JSZip from "jszip";
import {
  blocksToHTML,
  blocksToMarkdown,
  generateExportZip,
  importFromMarkdown,
  importNotebooksFromZip,
  inspectNotebookImportZip,
} from "../../src/lib/export";
import { inlineExportMediaAsBase64 } from "../../src/lib/export/inlineImagesBase64";
import type { Page } from "../../src/types";

const notebookId = "notebook-export";
const imageRef = "att:goose-img/pixel.png";
const fileRef = "att-file:goose-file/report.pdf";
const audioRef = "att-file:goose-file/chime.mp3";
const videoRef = "att-video:goose-file/clip.mp4";


function installDomStub(documentElement: any) {
  if (!documentElement.style) {
    documentElement.style = { setProperty() {}, removeProperty() {} };
  }
  if (typeof documentElement.getAttribute !== "function") {
    documentElement.getAttribute = () => null;
    documentElement.setAttribute = () => undefined;
    documentElement.removeAttribute = () => undefined;
  }

  const styleEl = { type: "", textContent: "", appendChild() {}, setAttribute() {}, style: {} };
  (globalThis as any).document = {
    documentElement,
    head: { appendChild() {} },
    body: { appendChild() {} },
    getElementsByTagName: (tag: string) => (tag === "head" ? [(globalThis as any).document.head] : []),
    getElementById: () => null,
    createElement: () => ({ ...styleEl, id: "" }),
    createTextNode: (text: string) => ({ textContent: text, nodeType: 3 }),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

class TestFileReader {
  result: string | ArrayBuffer | null = null;
  error: unknown = null;
  onload: ((event?: unknown) => void) | null = null;
  onloadend: ((event?: unknown) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;

  private event() {
    return { target: this };
  }

  async readAsDataURL(blob: Blob) {
    try {
      const buffer = Buffer.from(await blob.arrayBuffer());
      this.result = `data:${blob.type};base64,${buffer.toString("base64")}`;
      this.onload?.(this.event());
      this.onloadend?.(this.event());
    } catch (error) {
      this.error = error;
      this.onerror?.(this.event());
    }
  }

  async readAsArrayBuffer(blob: Blob) {
    try {
      this.result = await blob.arrayBuffer();
      this.onload?.(this.event());
      this.onloadend?.(this.event());
    } catch (error) {
      this.error = error;
      this.onerror?.(this.event());
    }
  }
}

function installAttachmentRuntime(onGetAttachment?: (id: string) => void) {
  const attachments = new Map<string, { data: Uint8Array; type: string }>([
    [
      "goose-img/pixel.png",
      {
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        type: "image/png",
      },
    ],
    [
      "goose-file/report.pdf",
      {
        data: new TextEncoder().encode("%PDF-1.4\n"),
        type: "application/pdf",
      },
    ],
    [
      "goose-file/chime.mp3",
      {
        data: new Uint8Array([0x49, 0x44, 0x33]),
        type: "audio/mpeg",
      },
    ],
    [
      "goose-file/clip.mp4",
      {
        data: new Uint8Array([0x00, 0x00, 0x00, 0x18]),
        type: "video/mp4",
      },
    ],
  ]);

  const classes = new Set<string>();
  const documentElement = {
    classList: {
      add: (className: string) => classes.add(className),
      remove: (className: string) => classes.delete(className),
      contains: (className: string) => classes.has(className),
    },
    setAttribute: () => undefined,
    removeAttribute: () => undefined,
  };

  installDomStub(documentElement);
  (globalThis as any).window = {
    matchMedia: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
    localStorage: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
    utools: {
      db: {
        getAttachment: (id: string) => {
          onGetAttachment?.(id);
          return attachments.get(id)?.data ?? null;
        },
        getAttachmentType: (id: string) => attachments.get(id)?.type ?? null,
      },
      dbStorage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    },
  };
  (globalThis as any).FileReader = TestFileReader;
}

function installDbRuntime() {
  let rev = 0;
  const docs = new Map<string, { _id: string; _rev: string; data: any }>();
  const dbStorage = new Map<string, string>();
  const classes = new Set<string>();

  installDomStub({
    classList: {
      add: (className: string) => classes.add(className),
      remove: (className: string) => classes.delete(className),
      contains: (className: string) => classes.has(className),
    },
    setAttribute: () => undefined,
    removeAttribute: () => undefined,
  });

  (globalThis as any).window = {
    matchMedia: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
    localStorage: {
      getItem: (key: string) => dbStorage.get(key) ?? null,
      setItem: (key: string, value: string) => dbStorage.set(key, value),
      removeItem: (key: string) => dbStorage.delete(key),
    },
    utools: {
      db: {
        get: (id: string) => docs.get(id) ?? null,
        put: (doc: { _id: string; _rev?: string; data: unknown }) => {
          const nextRev = `rev-${++rev}`;
          docs.set(doc._id, { _id: doc._id, _rev: nextRev, data: doc.data });
          return { id: doc._id, ok: true, rev: nextRev };
        },
        remove: (id: string) => {
          docs.delete(id);
          return { id, ok: true };
        },
        allDocs: (prefix = "") =>
          Array.from(docs.values()).filter((doc) => doc._id.startsWith(prefix)),
      },
      dbStorage: {
        getItem: (key: string) => dbStorage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          dbStorage.set(key, value);
        },
        removeItem: (key: string) => {
          dbStorage.delete(key);
        },
      },
    },
  };

  return { docs };
}

function buildPage(): Page {
  return {
    id: "page-export",
    workspaceId: notebookId,
    isFolder: false,
    isLocked: false,
    fontSize: "default",
    fontFamily: "default",
    createdAt: 1,
    updatedAt: 1,
    content: [
      {
        type: "heading",
        props: { level: 1 },
        content: "Exported",
      },
      {
        type: "image",
        props: {
          url: imageRef,
          caption: "Pixel",
        },
      },
      {
        type: "file",
        props: {
          url: fileRef,
          name: "report.pdf",
        },
      },
    ],
  };
}

function buildLocalImagePage(id: string, localFilePath: string): Page {
  return {
    id,
    workspaceId: notebookId,
    isFolder: false,
    isLocked: false,
    fontSize: "default",
    fontFamily: "default",
    createdAt: 1,
    updatedAt: 1,
    localFilePath,
    content: [
      {
        type: "image",
        props: {
          url: "./assets/shared.png",
          caption: id,
        },
      },
    ],
  };
}

function buildMediaPage(): Page {
  return {
    id: "page-media-export",
    workspaceId: notebookId,
    isFolder: false,
    isLocked: false,
    fontSize: "default",
    fontFamily: "default",
    createdAt: 1,
    updatedAt: 1,
    content: [
      {
        type: "heading",
        props: { level: 1 },
        content: "Media",
      },
      {
        type: "audio",
        props: {
          url: audioRef,
        },
      },
      {
        type: "video",
        props: {
          url: videoRef,
        },
      },
    ],
  };
}

function buildDuplicateMediaPage(): Page {
  const page = buildMediaPage();
  page.id = "page-duplicate-media-export";
  page.content = [
    page.content[0],
    {
      type: "audio",
      props: {
        url: audioRef,
      },
    },
    {
      type: "audio",
      props: {
        url: audioRef,
      },
    },
  ];
  return page;
}

async function buildZipBlob() {
  installAttachmentRuntime();
  return generateExportZip(
    { format: "md", notebookIds: [notebookId] },
    { [notebookId]: { name: "Notebook" } },
    [buildPage()],
  );
}

test.afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { FileReader?: unknown }).FileReader;
});

test("generateExportZip rewrites metadata asset refs for internal images and files", async () => {
  const zipBlob = await buildZipBlob();
  const zip = await JSZip.loadAsync(zipBlob);
  const metadataFile = zip.file("backup-metadata.json");
  expect(metadataFile).not.toBeNull();

  const metadata = JSON.parse(await metadataFile!.async("text"));
  const [page] = metadata.pages;
  const imageBlock = page.content[1];
  const fileBlock = page.content[2];

  expect(imageBlock.props.url).toContain("assets/");
  expect(imageBlock.props.url).not.toBe(imageRef);
  expect(fileBlock.props.url).toContain("assets/");
  expect(fileBlock.props.url).not.toBe(fileRef);

  const assetPaths = Object.keys(zip.files).filter((path) =>
    path.includes("/assets/"),
  );
  expect(assetPaths.some((path) => path.endsWith(".png"))).toBe(true);
  expect(assetPaths.some((path) => path.endsWith(".pdf"))).toBe(true);
});

test("importNotebooksFromZip restores metadata asset refs to portable data URLs", async () => {
  const zipBlob = await buildZipBlob();
  const importedPages: Array<Partial<Page>> = [];

  await importNotebooksFromZip(
    zipBlob,
    (_name, _icon, id) => id ?? notebookId,
    async (data) => {
      importedPages.push(data);
      return data.id ?? "page-imported";
    },
  );

  const importedContent = importedPages[0].content as any[];
  expect(importedContent[1].props.url).toMatch(/^data:image\/png;base64,/);
  expect(importedContent[2].props.url).toMatch(
    /^data:application\/pdf;base64,/,
  );
});

test("importNotebooksFromZip keeps external urls that contain assets path", async () => {
  const zip = new JSZip();
  const externalUrl = "https://example.com/assets/shared.png";
  zip.file(
    "backup-metadata.json",
    JSON.stringify({
      version: 1,
      notebooks: [{ id: notebookId, name: "Notebook", icon: "BookOpen" }],
      pages: [
        {
          id: "external-assets-url",
          workspaceId: notebookId,
          isFolder: false,
          content: [
            {
              type: "image",
              props: {
                url: externalUrl,
              },
            },
          ],
        },
      ],
    }),
  );
  zip.file("Notebook/assets/shared.png", "aW1wb3J0ZWQ=", { base64: true });

  const importedPages: Array<Partial<Page>> = [];
  await importNotebooksFromZip(
    (await zip.generateAsync({ type: "arraybuffer" })) as unknown as Blob,
    (_name, _icon, id) => id ?? notebookId,
    async (data) => {
      importedPages.push(data);
      return data.id ?? "page-imported";
    },
  );

  const importedContent = importedPages[0].content as any[];
  expect(importedContent[0].props.url).toBe(externalUrl);
});

test("metadata import failure propagates without falling back into duplicate folder import", async () => {
  const zip = new JSZip();
  zip.file(
    "backup-metadata.json",
    JSON.stringify({
      version: 1,
      notebooks: [{ id: notebookId, name: "Notebook", icon: "BookOpen" }],
      pages: [
        {
          id: "page-that-fails",
          workspaceId: notebookId,
          content: [{ type: "paragraph", content: "Imported" }],
        },
      ],
    }),
  );
  zip.file("Notebook/fallback.md", "# 不应回退导入");

  let notebookCreates = 0;
  await expect(
    importNotebooksFromZip(
      (await zip.generateAsync({ type: "arraybuffer" })) as unknown as Blob,
      (_name, _icon, id) => {
        notebookCreates += 1;
        return id ?? notebookId;
      },
      async () => {
        throw new Error("模拟页面写入失败");
      },
    ),
  ).rejects.toThrow("模拟页面写入失败");
  expect(notebookCreates).toBe(1);
});

test("importNotebooksFromZip scrubs local paths and remaps history to created page id", async () => {
  const { docs } = installDbRuntime();
  const zip = new JSZip();
  zip.file(
    "backup-metadata.json",
    JSON.stringify({
      version: 1,
      notebooks: [{ id: notebookId, name: "Notebook", icon: "BookOpen" }],
      pages: [
        {
          id: "source-page",
          workspaceId: notebookId,
          isFolder: false,
          localFilePath: "/old-machine/notes/source.md",
          content: [{ type: "paragraph", content: "Imported" }],
        },
      ],
      history: {
        "source-page": {
          index: {
            pageId: "source-page",
            versions: [
              {
                versionId: "v1",
                createdAt: 1,
                trigger: "manual",
                isMilestone: false,
                charCount: 8,
                charDelta: 8,
                size: 64,
              },
            ],
            lastVersionCharCount: 8,
          },
          versions: [
            {
              versionId: "v1",
              pageId: "source-page",
              workspaceId: notebookId,
              createdAt: 1,
              trigger: "manual",
              isMilestone: false,
              charCount: 8,
              charDelta: 8,
              size: 64,
              content: [{ type: "paragraph", content: "Imported" }],
            },
          ],
        },
      },
    }),
  );

  const importedPages: Array<Partial<Page>> = [];
  await importNotebooksFromZip(
    (await zip.generateAsync({ type: "arraybuffer" })) as unknown as Blob,
    (_name, _icon, id) => id ?? notebookId,
    async (data, _workspaceId, _parentId, id) => {
      importedPages.push(data);
      return `created-${id}`;
    },
  );

  expect(importedPages[0].localFilePath).toBeUndefined();
  expect(docs.has("gn:hist-idx:source-page")).toBe(false);
  expect(docs.get("gn:hist-idx:created-source-page")?.data).toMatchObject({
    pageId: "created-source-page",
  });
  expect(docs.get("gn:hist:created-source-page:v1")?.data).toMatchObject({
    pageId: "created-source-page",
  });
});

test("generateExportZip bundles audio and video attachment refs", async () => {
  installAttachmentRuntime();

  const zipBlob = await generateExportZip(
    { format: "md", notebookIds: [notebookId] },
    { [notebookId]: { name: "Notebook" } },
    [buildMediaPage()],
  );

  const zip = await JSZip.loadAsync(zipBlob);
  const metadataFile = zip.file("backup-metadata.json");
  expect(metadataFile).not.toBeNull();

  const metadata = JSON.parse(await metadataFile!.async("text"));
  const [page] = metadata.pages;
  const audioBlock = page.content[1];
  const videoBlock = page.content[2];

  expect(audioBlock.props.url).toContain("assets/");
  expect(audioBlock.props.url).not.toBe(audioRef);
  expect(videoBlock.props.url).toContain("assets/");
  expect(videoBlock.props.url).not.toBe(videoRef);

  const assetPaths = Object.keys(zip.files).filter((path) =>
    path.includes("/assets/"),
  );
  expect(assetPaths.some((path) => path.endsWith(".mp3"))).toBe(true);
  expect(assetPaths.some((path) => path.endsWith(".mp4"))).toBe(true);

  const markdownPath = Object.keys(zip.files).find((path) =>
    path.endsWith("/Media.md"),
  );
  expect(markdownPath).toBeTruthy();
  const markdown = await zip.file(markdownPath!)!.async("text");
  expect(markdown).toMatch(
    /<video src="\.\/assets\/[^"\s]+\.mp4" controls preload="metadata"><\/video>/,
  );
});

test("standalone Markdown and HTML exports inline playable video", async () => {
  installAttachmentRuntime();
  const content = buildMediaPage().content;

  await inlineExportMediaAsBase64(content);

  const videoBlock = content[2] as { props: { url: string } };
  expect(videoBlock.props.url).toMatch(/^data:video\/mp4;base64,/);

  const markdown = await blocksToMarkdown(content);
  expect(markdown).toContain(
    `<video src="${videoBlock.props.url}" controls preload="metadata"></video>`,
  );

  const html = await blocksToHTML(content);
  expect(html).toContain(
    `<video src="${videoBlock.props.url}" controls preload="metadata"></video>`,
  );

  const externalVideo = [
    {
      type: "video",
      props: { url: 'https://example.com/clip.mp4?token=a&label="demo"' },
    },
  ] as any;
  const externalMarkdown = await blocksToMarkdown(externalVideo);
  const imported = importFromMarkdown(externalMarkdown, undefined, {
    preserveStructure: true,
  });
  expect((imported.content[0] as { props: { url: string } }).props.url).toBe(
    'https://example.com/clip.mp4?token=a&label="demo"',
  );
});

test("generateExportZip reuses bundled attachment refs before repeated loads", async () => {
  const reads: string[] = [];
  installAttachmentRuntime((id) => reads.push(id));

  const zipBlob = await generateExportZip(
    { format: "md", notebookIds: [notebookId] },
    { [notebookId]: { name: "Notebook" } },
    [buildDuplicateMediaPage()],
  );

  const zip = await JSZip.loadAsync(zipBlob);
  const metadataFile = zip.file("backup-metadata.json");
  expect(metadataFile).not.toBeNull();

  const metadata = JSON.parse(await metadataFile!.async("text"));
  const [page] = metadata.pages;
  const firstAudioUrl = page.content[1].props.url;
  const secondAudioUrl = page.content[2].props.url;

  expect(firstAudioUrl).toContain("assets/");
  expect(secondAudioUrl).toBe(firstAudioUrl);
  expect(reads.filter((id) => id === "goose-file/chime.mp3")).toHaveLength(1);
});

test("generateExportZip keeps same relative image names separate across local folders", async () => {
  const reads: string[] = [];
  const classes = new Set<string>();
  installDomStub({
    classList: {
      add: (className: string) => classes.add(className),
      remove: (className: string) => classes.delete(className),
      contains: (className: string) => classes.has(className),
    },
    setAttribute: () => undefined,
    removeAttribute: () => undefined,
  });
  (globalThis as any).window = {
    matchMedia: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
    localStorage: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
    gooseFs: {
      readFileBase64: (path: string) => {
        reads.push(path);
        return path.includes("/b/") ? "YmJi" : "YQ==";
      },
    },
  };
  (globalThis as any).FileReader = TestFileReader;

  const zipBlob = await generateExportZip(
    { format: "md", notebookIds: [notebookId] },
    { [notebookId]: { name: "Notebook", localPath: "C:/notes" } },
    [
      buildLocalImagePage("page-a", "C:/notes/a/page.md"),
      buildLocalImagePage("page-b", "C:/notes/b/page.md"),
    ],
  );

  const zip = await JSZip.loadAsync(zipBlob);
  const metadataFile = zip.file("backup-metadata.json");
  expect(metadataFile).not.toBeNull();

  const metadata = JSON.parse(await metadataFile!.async("text"));
  const imageUrls = metadata.pages.map(
    (page: Page) => (page.content as any[])[0].props.url,
  );
  const assetPaths = Object.keys(zip.files).filter(
    (path) => path.includes("/assets/") && !zip.files[path].dir,
  );

  expect(new Set(imageUrls).size).toBe(2);
  expect(assetPaths).toHaveLength(2);
  expect(reads).toEqual([
    "C:/notes/a/assets/shared.png",
    "C:/notes/b/assets/shared.png",
  ]);
});

test("inspectNotebookImportZip accepts a valid metadata backup without mutating stores", async () => {
  const zip = new JSZip();
  zip.file(
    "backup-metadata.json",
    JSON.stringify({
      version: 1,
      notebooks: [{ id: "nb-1", name: "Note" }],
      pages: [{ id: "page-1", workspaceId: "nb-1", content: [] }],
      history: {},
    }),
  );

  const result = await inspectNotebookImportZip(
    await zip.generateAsync({ type: "blob" }),
  );

  expect(result).toEqual({
    source: "metadata",
    notebookCount: 1,
    pageCount: 1,
  });
});

test("inspectNotebookImportZip rejects damaged metadata before destructive restore", async () => {
  const zip = new JSZip();
  zip.file("backup-metadata.json", "{not-json");

  await expect(
    inspectNotebookImportZip(await zip.generateAsync({ type: "blob" })),
  ).rejects.toThrow("备份元数据已损坏");
});

test("inspectNotebookImportZip rejects an empty zip before destructive restore", async () => {
  const zip = new JSZip();

  await expect(
    inspectNotebookImportZip(await zip.generateAsync({ type: "blob" })),
  ).rejects.toThrow("没有可恢复的鹅的笔记数据");
});
