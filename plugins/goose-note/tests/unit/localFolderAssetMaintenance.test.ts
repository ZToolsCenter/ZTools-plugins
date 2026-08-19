import { expect, test } from "playwright/test";
import { scanUnreferencedLocalAssets } from "../../src/lib/local-folder-asset-maintenance";

interface Entry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  path: string;
  size: number;
}

function createFs(entries: Record<string, Entry[]>) {
  return {
    readDir: (path: string) => entries[path] ?? [],
    readFile: () => null,
    writeFile: () => false,
    exists: () => false,
    watch: () => undefined,
    unwatch: () => undefined,
    mkdir: () => false,
    deleteFile: () => false,
    deleteDir: () => false,
    rename: () => false,
  };
}

test("扫描深层内容中的本地资源引用，并保留根 assets 兼容目录", async () => {
  const result = await scanUnreferencedLocalAssets({
    basePath: "/notes",
    gooseFs: createFs({
      "/notes/assets": [
        {
          name: "legacy.png",
          isFile: true,
          isDirectory: false,
          path: "/notes/assets/legacy.png",
          size: 12,
        },
        {
          name: "unused.png",
          isFile: true,
          isDirectory: false,
          path: "/notes/assets/unused.png",
          size: 8,
        },
      ],
      "/notes/project/assets": [
        {
          name: "used.mp4",
          isFile: true,
          isDirectory: false,
          path: "/notes/project/assets/used.mp4",
          size: 20,
        },
      ],
    }),
    pages: [
      {
        localFilePath: "/notes/project/note.md",
        isFolder: false,
        content: {
          type: "doc",
          content: [
            {
              type: "table",
              rows: [
                {
                  cells: [
                    {
                      children: [
                        { type: "video", props: { src: "./assets/used.mp4" } },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: "image",
              attrs: { url: "/notes/assets/legacy.png" },
            },
          ],
        },
      },
    ],
  });

  expect(result).toEqual([
    {
      path: "/notes/assets/unused.png",
      relativePath: "assets/unused.png",
      name: "unused.png",
      size: 8,
    },
  ]);
});
