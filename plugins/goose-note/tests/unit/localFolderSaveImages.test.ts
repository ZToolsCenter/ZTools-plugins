import { expect, test } from "playwright/test";
import { saveLocalPageContentAction } from "../../src/stores/pages/actions/localFolder/write";
import {
  deleteLocalMdSnapshot,
  setLocalMdSnapshot,
} from "../../src/lib/local-md-snapshot";

const pageId = "page-image";
const filePath = "C:/notes/image-note.md";

test.afterEach(() => {
  deleteLocalMdSnapshot(filePath);
  delete (globalThis as { window?: unknown }).window;
});

test("saveLocalPageContent writes root image data URLs to local assets", async () => {
  const base64 = "iVBORw0KGgo=";
  const dataUrl = `data:image/png;base64,${base64}`;
  const disk = new Map<string, string>([[filePath, ""]]);
  const writes: Array<{ path: string; content: string; encoding?: string }> = [];

  (globalThis as any).window = {
    gooseFs: {
      exists: (path: string) => disk.has(path),
      mkdir: () => true,
      readFileStatAsync: async (path: string) => ({
        ok: true,
        content: disk.get(path) ?? "",
      }),
      readFileAsync: async (path: string) => disk.get(path) ?? "",
      writeFileAsync: async (
        path: string,
        content: string,
        encoding?: string,
      ) => {
        writes.push({ path, content, encoding });
        disk.set(path, content);
        return true;
      },
    },
    dispatchEvent: () => true,
  };

  setLocalMdSnapshot(filePath, "");

  let state: any = {
    pages: {
      [pageId]: {
        id: pageId,
        workspaceId: "notebook-local",
        isFolder: false,
        localFilePath: filePath,
        content: [],
      },
    },
    dirtyLocalPageIds: { [pageId]: true },
    lastSavedAt: null,
    getLocalFilePath: (id: string) => (id === pageId ? filePath : null),
  };
  const set = (update: any) => {
    const patch = typeof update === "function" ? update(state) : update;
    state = { ...state, ...patch };
  };
  const get = () => state;

  const content = [
    {
      type: "image",
      props: {
        url: dataUrl,
        caption: "Pixels",
      },
    },
  ];

  const saved = await saveLocalPageContentAction(
    set,
    get,
    pageId,
    content,
  );

  expect(saved).toBe(true);
  expect(content[0].props.url).toBe(dataUrl);
  const markdownWrite = writes.find((write) => write.path === filePath);
  expect(markdownWrite?.content).toContain("![Pixels](./assets/img_");
  expect(markdownWrite?.content).not.toContain(dataUrl);

  const assetWrite = writes.find((write) => write.path.includes("/assets/img_"));
  expect(assetWrite).toMatchObject({
    content: base64,
    encoding: "base64",
  });
});

test("saveLocalPageContent rechecks disk before writing markdown", async () => {
  const writes: Array<{ path: string; content: string; encoding?: string }> = [];
  const conflicts: Array<{ pageId: string; filePath: string; source: string }> = [];
  let readCount = 0;

  (globalThis as any).window = {
    gooseFs: {
      exists: (path: string) => path === filePath,
      readFileStatAsync: async () => {
        readCount += 1;
        return {
          ok: true,
          content: readCount === 1 ? "" : "external edit",
        };
      },
      readFileAsync: async () => "",
      writeFileAsync: async (
        path: string,
        content: string,
        encoding?: string,
      ) => {
        writes.push({ path, content, encoding });
        return true;
      },
    },
    dispatchEvent: (event: CustomEvent) => {
      conflicts.push(event.detail);
      return true;
    },
  };

  setLocalMdSnapshot(filePath, "");

  let state: any = {
    pages: {
      [pageId]: {
        id: pageId,
        workspaceId: "notebook-local",
        isFolder: false,
        localFilePath: filePath,
        content: [],
      },
    },
    dirtyLocalPageIds: { [pageId]: true },
    lastSavedAt: null,
    getLocalFilePath: (id: string) => (id === pageId ? filePath : null),
  };
  const set = (update: any) => {
    const patch = typeof update === "function" ? update(state) : update;
    state = { ...state, ...patch };
  };
  const get = () => state;

  const saved = await saveLocalPageContentAction(set, get, pageId, [
    {
      type: "paragraph",
      content: "mine",
    },
  ]);

  expect(saved).toBe(false);
  expect(writes).toEqual([]);
  expect(conflicts).toEqual([
    { pageId, filePath, source: "pre-write" },
  ]);
});
