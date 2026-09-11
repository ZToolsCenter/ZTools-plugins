import type { PasteItem, Pinboard } from "@pasteboard-pro/core";
import { deepFreeze } from "#freeze";

export const historyFixture = deepFreeze([
  {
    id: "text-old",
    kind: "text",
    title: "Accounts payable notes",
    sourceApp: {
      bundleId: "com.apple.TextEdit",
      name: "TextEdit",
    },
    sourceDeviceId: "device-mac-studio",
    copiedAt: "2026-07-10T08:15:00.000Z",
    updatedAt: "2026-07-10T08:20:00.000Z",
    contentFingerprint: "sha256:text-old:v1",
    payload: {
      revision: "revision:text-old:v1",
      text: "Invoice #1042 is due on July 31 for USD 480.00.",
    },
    pinboardId: "board-work",
    pinboardOrderKey: "a0",
    pinned: true,
    fieldClocks: {
      title: { wallMs: 1783671300000, counter: 0, deviceId: "device-mac-studio" },
      payload: { wallMs: 1783671300000, counter: 1, deviceId: "device-mac-studio" },
      pinboardId: { wallMs: 1783671600000, counter: 0, deviceId: "device-mac-studio" },
      pinboardOrderKey: { wallMs: 1783671600000, counter: 1, deviceId: "device-mac-studio" },
      pinned: { wallMs: 1783671600000, counter: 2, deviceId: "device-mac-studio" },
    },
  },
  {
    id: "image-new",
    kind: "image",
    title: "Scanned receipt",
    sourceApp: {
      bundleId: "com.apple.Preview",
      name: "Preview",
    },
    sourceDeviceId: "device-iphone-15",
    copiedAt: "2026-07-16T09:30:00.000Z",
    updatedAt: "2026-07-16T09:35:00.000Z",
    contentFingerprint: "sha256:image-new:v1",
    payload: {
      revision: "revision:image-new:v1",
      blobId: "blob:image-new:v1",
      mediaType: "image/png",
    },
    ocrText: "Invoice #1042 paid in full",
    pinboardId: "board-reference",
    pinboardOrderKey: "a0",
    pinned: false,
    fieldClocks: {
      payload: { wallMs: 1784194200000, counter: 0, deviceId: "device-iphone-15" },
      ocrText: { wallMs: 1784194500000, counter: 0, deviceId: "device-iphone-15" },
      pinboardId: { wallMs: 1784194500000, counter: 1, deviceId: "device-iphone-15" },
      pinboardOrderKey: { wallMs: 1784194500000, counter: 2, deviceId: "device-iphone-15" },
      pinned: { wallMs: 1784194500000, counter: 3, deviceId: "device-iphone-15" },
    },
  },
  {
    id: "url-middle",
    kind: "url",
    title: "Billing portal",
    sourceApp: {
      bundleId: "com.google.Chrome",
      name: "Google Chrome",
    },
    sourceDeviceId: "device-macbook-air",
    copiedAt: "2026-07-14T14:00:00.000Z",
    updatedAt: "2026-07-14T14:05:00.000Z",
    contentFingerprint: "sha256:url-middle:v1",
    payload: {
      revision: "revision:url-middle:v1",
      text: "https://billing.example.test/invoice/1042",
      html: "<a href=\"https://billing.example.test/invoice/1042\">Open invoice 1042</a>",
    },
    pinboardId: "board-reference",
    pinboardOrderKey: "a1",
    pinned: true,
    fieldClocks: {
      payload: { wallMs: 1784037600000, counter: 0, deviceId: "device-macbook-air" },
      pinboardId: { wallMs: 1784037900000, counter: 0, deviceId: "device-macbook-air" },
      pinboardOrderKey: { wallMs: 1784037900000, counter: 1, deviceId: "device-macbook-air" },
      pinned: { wallMs: 1784037900000, counter: 2, deviceId: "device-macbook-air" },
    },
  },
  {
    id: "files-item",
    kind: "files",
    title: "Quarterly report attachments",
    sourceApp: {
      bundleId: "com.apple.finder",
      name: "Finder",
    },
    sourceDeviceId: "device-mac-studio",
    copiedAt: "2026-07-13T11:45:00.000Z",
    updatedAt: "2026-07-13T11:50:00.000Z",
    contentFingerprint: "sha256:files-item:v1",
    payload: {
      revision: "revision:files-item:v1",
      filePaths: [
        "/Users/shared/Documents/quarterly-report.pdf",
        "/Users/shared/Documents/summary.txt",
      ],
    },
    pinboardId: "board-work",
    pinboardOrderKey: "a1",
    pinned: false,
    fieldClocks: {
      payload: { wallMs: 1783943100000, counter: 0, deviceId: "device-mac-studio" },
      pinboardId: { wallMs: 1783943400000, counter: 0, deviceId: "device-mac-studio" },
      pinboardOrderKey: { wallMs: 1783943400000, counter: 1, deviceId: "device-mac-studio" },
      pinned: { wallMs: 1783943400000, counter: 2, deviceId: "device-mac-studio" },
    },
  },
  {
    id: "color-item",
    kind: "color",
    title: "Brand violet",
    sourceApp: {
      bundleId: "com.figma.Desktop",
      name: "Figma",
    },
    sourceDeviceId: "device-macbook-air",
    copiedAt: "2026-07-12T16:10:00.000Z",
    updatedAt: "2026-07-12T16:12:00.000Z",
    contentFingerprint: "sha256:color-item:v1",
    payload: {
      revision: "revision:color-item:v1",
      text: "#6C5CE7",
    },
    pinned: false,
    fieldClocks: {
      payload: { wallMs: 1783872600000, counter: 0, deviceId: "device-macbook-air" },
      pinned: { wallMs: 1783872720000, counter: 0, deviceId: "device-macbook-air" },
    },
  },
] satisfies readonly PasteItem[]);

export const pinboardFixture = deepFreeze([
  {
    id: "board-work",
    name: "Work",
    color: "#4C6FFF",
    orderKey: "a0",
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-10T08:20:00.000Z",
    fieldClocks: {
      name: { wallMs: 1782892800000, counter: 0, deviceId: "device-mac-studio" },
      color: { wallMs: 1782892800000, counter: 1, deviceId: "device-mac-studio" },
      orderKey: { wallMs: 1782892800000, counter: 2, deviceId: "device-mac-studio" },
    },
  },
  {
    id: "board-reference",
    name: "Reference",
    color: "#00A884",
    orderKey: "a2",
    createdAt: "2026-07-02T08:00:00.000Z",
    updatedAt: "2026-07-16T09:35:00.000Z",
    fieldClocks: {
      name: { wallMs: 1782979200000, counter: 0, deviceId: "device-macbook-air" },
      color: { wallMs: 1782979200000, counter: 1, deviceId: "device-macbook-air" },
      orderKey: { wallMs: 1782979200000, counter: 2, deviceId: "device-macbook-air" },
    },
  },
] satisfies readonly Pinboard[]);
