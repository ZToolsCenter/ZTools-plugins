import { z } from "zod";

export const HybridClockSchema = z.object({
  wallMs: z.number().int(),
  counter: z.number().int().nonnegative(),
  deviceId: z.string().min(1),
});

export const PastePayloadSchema = z.object({
  revision: z.string().min(1),
  text: z.string().optional(),
  html: z.string().optional(),
  blobId: z.string().optional(),
  mediaType: z.string().optional(),
  filePaths: z.array(z.string()).optional(),
});

export const PasteItemSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "text",
    "rich_text",
    "html",
    "url",
    "image",
    "pdf",
    "color",
    "files",
  ]),
  title: z.string().optional(),
  sourceApp: z
    .object({
      bundleId: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  sourceDeviceId: z.string().min(1),
  copiedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  contentFingerprint: z.string().min(1),
  payload: PastePayloadSchema,
  ocrText: z.string().optional(),
  pinboardId: z.string().optional(),
  pinboardOrderKey: z.string().optional(),
  pinned: z.boolean(),
  fieldClocks: z.record(HybridClockSchema),
});

export const PinboardSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.string().min(1),
  orderKey: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  fieldClocks: z.record(HybridClockSchema),
});

export type HybridClock = z.infer<typeof HybridClockSchema>;
export type PastePayload = z.infer<typeof PastePayloadSchema>;
export type PasteItem = z.infer<typeof PasteItemSchema>;
export type Pinboard = z.infer<typeof PinboardSchema>;
