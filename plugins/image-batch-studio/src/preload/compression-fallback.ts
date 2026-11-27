import type { Metadata } from "sharp";

/**
 * 压缩结果“回退原图”的隐私判定。
 *
 * 同格式纯压缩时，如果重新编码后的体积 >= 原图，旧逻辑会把原始文件原样写出，
 * EXIF / GPS / XMP / IPTC 等元数据也会一起带出去，即使用户关闭了「保留元数据」。
 * 规则：去元数据优先于体积。只有原图本身不含隐私元数据，
 * 或用户明确要求保留元数据时，才允许回退到原图。
 */

export type PrivateMetadataFields = Pick<Metadata, "exif" | "xmp" | "iptc" | "tifftagPhotoshop" | "comments">;

export function hasPrivateMetadata(metadata: Partial<PrivateMetadataFields>): boolean {
  const hasBytes = (value: Buffer | undefined) => Boolean(value && value.byteLength > 0);
  return (
    hasBytes(metadata.exif) ||
    hasBytes(metadata.xmp) ||
    hasBytes(metadata.iptc) ||
    hasBytes(metadata.tifftagPhotoshop) ||
    Boolean(metadata.comments && metadata.comments.length > 0)
  );
}

export interface CompressionFallbackInput {
  /** 纯压缩、同格式、没有几何或内容变换时，才考虑回退原图。 */
  eligible: boolean;
  keepMetadata: boolean;
  inputBytes: number;
  outputBytes: number;
  /** 懒加载：只在确实要回退时才读原图元数据。读取失败一律视为含隐私元数据。 */
  sourceHasPrivateMetadata: () => Promise<boolean>;
}

export interface CompressionFallbackDecision {
  useOriginal: boolean;
  /** 为去掉元数据，输出比原图大，界面需要告知用户。 */
  outputLargerForPrivacy: boolean;
}

export async function decideCompressionFallback(
  input: CompressionFallbackInput
): Promise<CompressionFallbackDecision> {
  if (!input.eligible || input.outputBytes < input.inputBytes) {
    return { useOriginal: false, outputLargerForPrivacy: false };
  }
  if (input.keepMetadata) {
    return { useOriginal: true, outputLargerForPrivacy: false };
  }
  let carriesPrivate = true;
  try {
    carriesPrivate = await input.sourceHasPrivateMetadata();
  } catch {
    carriesPrivate = true;
  }
  if (carriesPrivate) {
    return { useOriginal: false, outputLargerForPrivacy: input.outputBytes > input.inputBytes };
  }
  return { useOriginal: true, outputLargerForPrivacy: false };
}
