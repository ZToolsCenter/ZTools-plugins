import { expect, test } from "playwright/test";
import { uploadEditorFile } from "../../src/components/editor/utils/uploadEditorFile";

test("uploadEditorFile stores non-image files as persistent attachments", async () => {
  const savedFiles: File[] = [];
  const file = new File(["hello"], "notes.txt", { type: "text/plain" });

  const url = await uploadEditorFile(file, undefined, {
    getBlock: () => null,
    imageStorage: {
      save: async () => {
        throw new Error("images only");
      },
    },
    fileStorage: {
      save: async (input) => {
        savedFiles.push(input);
        return {
          storageRef: "att-file:goose-file/notes.txt",
          fileName: "notes.txt",
          mimeType: "text/plain",
          size: input.size,
          uploadedAt: 1,
        };
      },
    },
    getFileUploadAvailability: () => ({ enabled: true }),
  });

  expect(url).toBe("att-file:goose-file/notes.txt");
  expect(savedFiles).toEqual([file]);
});

test("uploadEditorFile keeps image files in file storage when replacing a file block", async () => {
  const savedFiles: File[] = [];
  const imageFile = new File(["png"], "diagram.png", { type: "image/png" });

  const url = await uploadEditorFile(imageFile, "file-block", {
    getBlock: (id) => (id === "file-block" ? { type: "file" } : null),
    imageStorage: {
      save: async () => {
        throw new Error("file block images should not use image storage");
      },
    },
    fileStorage: {
      save: async (input) => {
        savedFiles.push(input);
        return {
          storageRef: "att-file:goose-file/diagram.png",
          fileName: "diagram.png",
          mimeType: "image/png",
          size: input.size,
          uploadedAt: 1,
        };
      },
    },
    getFileUploadAvailability: () => ({ enabled: true }),
  });

  expect(url).toBe("att-file:goose-file/diagram.png");
  expect(savedFiles).toEqual([imageFile]);
});

test("uploadEditorFile rejects unsupported local-folder file attachments", async () => {
  const file = new File(["hello"], "notes.txt", { type: "text/plain" });

  await expect(
    uploadEditorFile(file, undefined, {
      getBlock: () => null,
      imageStorage: {
        save: async () => {
          throw new Error("images only");
        },
      },
      fileStorage: {
        save: async () => {
          throw new Error("should not save");
        },
      },
      getFileUploadAvailability: () => ({
        enabled: false,
        reason: "本地文件夹记事本暂不支持附件上传",
      }),
    }),
  ).rejects.toThrow("本地文件夹记事本暂不支持附件上传");
});
