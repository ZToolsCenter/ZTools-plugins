import { useCallback, useEffect, useRef, useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import { Zoom } from "yet-another-react-lightbox/plugins";
import { Copy, Download, X, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import type { BlockNoteEditor } from "@blocknote/core";
import { blobToBase64 } from "@/lib/imageStorage/utils";
import { convertImageBlobToPng } from "@/lib/imageProcessor";
import { useEditorPlatform } from "@/components/editor/platform/context";
import {
  useEditorPageContext,
  useEditorSettings,
} from "@/components/editor/platform/hostContext";
import { openResourceExternally } from "@/components/editor/utils/openResourceExternally";
import {
  resolveImageSrc,
  getImageElements,
  getImageBlockElement,
  getBlockIdFromImage,
  getImageSrc,
  getImageBlockIdByIndex,
  getImageAlignmentFromBlock,
  type ImageAlignment,
} from "./imageUtils";
import {
  ImageToolbar,
  type SelectedImageState,
} from "@/components/editor/image/ImageToolbar";

interface ImageLightboxProps {
  editor: BlockNoteEditor<any, any, any>;
  editorContainerRef: React.RefObject<HTMLDivElement | null>;
}

interface SlideInfo {
  src: string;
  alt?: string;
}

export function ImageLightbox({
  editor,
  editorContainerRef,
}: ImageLightboxProps) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [slides, setSlides] = useState<SlideInfo[]>([]);
  const [selectedImage, setSelectedImage] = useState<SelectedImageState | null>(
    null,
  );
  const resolvedUrlsRef = useRef<Map<string, string>>(new Map());
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const selectedImageRef = useRef<SelectedImageState | null>(null);
  const platform = useEditorPlatform();
  const { getActivePageLocalFilePath } = useEditorPageContext();
  const { useInternalImageViewer } = useEditorSettings();

  const cleanupObjectUrls = useCallback(() => {
    objectUrlsRef.current.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    });
    objectUrlsRef.current.clear();
    resolvedUrlsRef.current.clear();
  }, []);

  useEffect(() => {
    return () => {
      cleanupObjectUrls();
    };
  }, [cleanupObjectUrls]);

  useEffect(() => {
    selectedImageRef.current = selectedImage;
  }, [selectedImage]);

  const buildSlides = useCallback(
    async (container: HTMLElement): Promise<SlideInfo[]> => {
      const images = getImageElements(container);
      const slides: SlideInfo[] = [];

      for (const img of images) {
        const src = img.src || img.getAttribute("src") || "";
        const alt = img.alt || img.getAttribute("alt") || "";

        if (!src) continue;

        let resolved = resolvedUrlsRef.current.get(src);
        if (!resolved) {
          resolved = await resolveImageSrc(
            src,
            platform,
            getActivePageLocalFilePath(),
          );
          resolvedUrlsRef.current.set(src, resolved);
          if (resolved.startsWith("blob:")) {
            objectUrlsRef.current.add(resolved);
          }
        }

        slides.push({ src: resolved, alt });
      }

      return slides;
    },
    [platform, getActivePageLocalFilePath],
  );

  const openLightboxAtImage = useCallback(
    async (img: HTMLImageElement) => {
      const container = editorContainerRef.current;
      if (!container) return;

      const images = getImageElements(container);
      const clickedIndex = images.indexOf(img);
      if (clickedIndex < 0) return;

      const newSlides = await buildSlides(container);
      if (newSlides.length === 0) return;

      setSlides(newSlides);
      setIndex(clickedIndex);
      setOpen(true);
    },
    [editorContainerRef, buildSlides],
  );

  const openImageAtElement = useCallback(
    async (img: HTMLImageElement) => {
      // 速记小窗：双击始终交给系统查看器，不走内置灯箱回退（小窗无完整 gooseFs
      // 时会误弹「已改用内置预览」；preload 已补最小 writeTempFile）。
      const preferSystemViewer =
        (typeof __GOOSE_LITE__ !== "undefined" && __GOOSE_LITE__) ||
        !useInternalImageViewer;

      if (!preferSystemViewer) {
        await openLightboxAtImage(img);
        return;
      }

      const container = editorContainerRef.current;
      if (!container) return;
      const imageIndex = getImageElements(container).indexOf(img);
      const blockId =
        getBlockIdFromImage(img, container) ||
        getImageBlockIdByIndex(editor.document as any[], imageIndex);
      const block = blockId ? editor.getBlock(blockId) : null;
      const rawSource =
        (block?.props as { url?: string } | undefined)?.url || getImageSrc(img);
      const result = await openResourceExternally({
        source: rawSource,
        fileName:
          img.alt ||
          img.getAttribute("alt") ||
          (block?.props as { name?: string } | undefined)?.name ||
          "image",
        mimeType: "image/png",
        pageLocalFilePath: getActivePageLocalFilePath(),
        platform,
        loadInternalResource: (source) => platform.imageStorage.load(source),
      });
      if (result.ok) return;

      // 小窗：只报失败，不改用内置预览，避免「明明想系统打开却弹出灯箱」。
      if (typeof __GOOSE_LITE__ !== "undefined" && __GOOSE_LITE__) {
        toast.error("系统图片查看器打开失败", {
          description: result.error || "未知错误",
        });
        return;
      }

      toast.error("系统图片查看器打开失败", {
        description: `${result.error || "未知错误"}，已改用内置预览`,
      });
      await openLightboxAtImage(img);
    },
    [
      editor,
      editorContainerRef,
      getActivePageLocalFilePath,
      openLightboxAtImage,
      platform,
      useInternalImageViewer,
    ],
  );

  const handleImageDoubleClick = useCallback(
    async (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const img = target.closest<HTMLImageElement>(
        '.bn-block-content[data-content-type="image"] img, .bn-block-content[data-content-type="imageResize"] img',
      );
      if (!img) return;

      event.preventDefault();
      event.stopPropagation();

      await openImageAtElement(img);
    },
    [openImageAtElement],
  );

  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    container.addEventListener("dblclick", handleImageDoubleClick);
    return () => {
      container.removeEventListener("dblclick", handleImageDoubleClick);
    };
  }, [editorContainerRef, handleImageDoubleClick]);

  const updateSelectedImageFromElement = useCallback(
    (img: HTMLImageElement) => {
      const container = editorContainerRef.current;
      if (!container) return;

      const imageIndex = getImageElements(container).indexOf(img);
      const blockId =
        getBlockIdFromImage(img, container) ||
        getImageBlockIdByIndex(editor.document as any[], imageIndex);
      const block = blockId ? editor.getBlock(blockId) : null;
      const blockElement = getImageBlockElement(img, container);
      const anchorElement = __GOOSE_EDITOR_COMPACT__
        ? (blockElement ?? img)
        : img;

      setSelectedImage({
        blockId,
        src:
          (block?.props as { url?: string } | undefined)?.url ||
          getImageSrc(img),
        alt: img.alt || img.getAttribute("alt") || "",
        index: imageIndex,
        rect: anchorElement.getBoundingClientRect(),
        alignment: getImageAlignmentFromBlock(block),
      });
    },
    [editor, editorContainerRef],
  );

  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      const img = target?.closest<HTMLImageElement>(
        '.bn-block-content[data-content-type="image"] img, .bn-block-content[data-content-type="imageResize"] img',
      );

      if (!img || !container.contains(img)) {
        if (!target?.closest("[data-goose-image-toolbar]")) {
          setSelectedImage(null);
        }
        return;
      }

      updateSelectedImageFromElement(img);
    };

    const handleReposition = () => {
      const current = selectedImageRef.current;
      if (!current) return;
      const images = getImageElements(container);
      const img = images[current.index];
      if (!img) {
        setSelectedImage(null);
        return;
      }
      updateSelectedImageFromElement(img);
    };

    container.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("resize", handleReposition);
    return () => {
      container.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("resize", handleReposition);
    };
  }, [editorContainerRef, updateSelectedImageFromElement]);

  const currentSlide = slides[index];

  const downloadImage = useCallback(
    async (src: string) => {
      let resolvedObjectUrl: string | null = null;
      try {
        const resolvedSrc = await resolveImageSrc(
          src,
          platform,
          getActivePageLocalFilePath(),
        );
        if (resolvedSrc.startsWith("blob:") && resolvedSrc !== src) {
          resolvedObjectUrl = resolvedSrc;
        }
        const response = await fetch(resolvedSrc);
        const sourceBlob = await response.blob();
        // 存储多为 WebP；下载统一转 PNG，兼容更多工具
        const blob = await convertImageBlobToPng(sourceBlob);
        const filename = `image-${Date.now()}.png`;

        const targetPath = await platform.dialog.showSaveDialog({
          title: "保存文件",
          defaultPath: filename,
          buttonLabel: "保存",
        });

        if (targetPath) {
          const base64 = await blobToBase64(blob);
          const payload = base64.replace(/^data:.*;base64,/, "");
          const saved = await platform.fs.writeFileAsync(
            targetPath,
            payload,
            "base64",
          );
          if (saved) {
            await platform.shell.showItemInFolder(targetPath);
            toast.success("图片已保存");
            return;
          }
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast.success("已开始下载");
      } catch (err) {
        toast.error(
          `下载失败: ${err instanceof Error ? err.message : "未知错误"}`,
        );
      } finally {
        if (resolvedObjectUrl) {
          try {
            URL.revokeObjectURL(resolvedObjectUrl);
          } catch {
            /* ignore */
          }
        }
      }
    },
    [platform, getActivePageLocalFilePath],
  );

  const handleDownload = useCallback(async () => {
    if (!currentSlide) return;
    await downloadImage(currentSlide.src);
  }, [currentSlide, downloadImage]);

  const copyImageToClipboard = useCallback(
    async (src: string) => {
      let resolvedObjectUrl: string | null = null;
      try {
        const resolvedSrc = await resolveImageSrc(
          src,
          platform,
          getActivePageLocalFilePath(),
        );
        if (resolvedSrc.startsWith("blob:") && resolvedSrc !== src) {
          resolvedObjectUrl = resolvedSrc;
        }
        const response = await fetch(resolvedSrc);
        const sourceBlob = await response.blob();
        // 剪贴板统一 PNG，避免 WebP 在部分 App 粘贴失败
        const blob = await convertImageBlobToPng(sourceBlob);
        const base64 = await blobToBase64(blob);
        await platform.clipboard.copyImage(base64);
        toast.success("已复制到剪贴板");
      } catch (err) {
        toast.error(
          `复制失败: ${err instanceof Error ? err.message : "未知错误"}`,
        );
      } finally {
        if (resolvedObjectUrl) {
          try {
            URL.revokeObjectURL(resolvedObjectUrl);
          } catch {
            /* ignore */
          }
        }
      }
    },
    [platform, getActivePageLocalFilePath],
  );

  const handleCopy = useCallback(async () => {
    if (!currentSlide) return;
    await copyImageToClipboard(currentSlide.src);
  }, [copyImageToClipboard, currentSlide]);

  const applyImageAlignment = useCallback(
    (alignment: ImageAlignment) => {
      if (!selectedImage?.blockId) return;
      const block = editor.getBlock(selectedImage.blockId);
      if (!block) return;

      editor.updateBlock(block, {
        props: { textAlignment: alignment },
      } as any);

      setSelectedImage((current) =>
        current ? { ...current, alignment } : current,
      );
    },
    [editor, selectedImage],
  );

  const handleSelectedImageZoom = useCallback(async () => {
    const container = editorContainerRef.current;
    if (!container || !selectedImage) return;
    const img = getImageElements(container)[selectedImage.index];
    if (!img) return;
    await openImageAtElement(img);
  }, [editorContainerRef, openImageAtElement, selectedImage]);

  const getSelectedImageRect = useCallback(() => {
    const container = editorContainerRef.current;
    const current = selectedImageRef.current;
    if (!container || !current) return null;
    return (
      getImageElements(container)[current.index]?.getBoundingClientRect() ??
      null
    );
  }, [editorContainerRef]);

  const handleSelectedImageDownload = useCallback(async () => {
    if (!selectedImage) return;
    await downloadImage(selectedImage.src);
  }, [downloadImage, selectedImage]);

  const handleSelectedImageCopy = useCallback(async () => {
    if (!selectedImage) return;
    await copyImageToClipboard(selectedImage.src);
  }, [copyImageToClipboard, selectedImage]);

  return (
    <>
      {selectedImage && !open && (
        <ImageToolbar
          selectedImage={selectedImage}
          applyImageAlignment={applyImageAlignment}
          handleSelectedImageZoom={handleSelectedImageZoom}
          handleSelectedImageCopy={handleSelectedImageCopy}
          handleSelectedImageDownload={handleSelectedImageDownload}
          openImageLabel={
            (typeof __GOOSE_LITE__ !== "undefined" && __GOOSE_LITE__) ||
            !useInternalImageViewer
              ? "使用系统打开图片"
              : "放大图片"
          }
          floatingBoundary={
            !__GOOSE_EDITOR_COMPACT__ ? editorContainerRef.current : undefined
          }
          getReferenceRect={
            !__GOOSE_EDITOR_COMPACT__ ? getSelectedImageRect : undefined
          }
        />
      )}
      {slides.length > 0 && (
        <Lightbox
          open={open}
          close={() => setOpen(false)}
          index={index}
          slides={slides.map((s) => ({
            src: s.src,
            alt: s.alt,
            title: s.alt || undefined,
          }))}
          plugins={[Zoom]}
          zoom={{
            maxZoomPixelRatio: 4,
            scrollToZoom: true,
            doubleClickDelay: 250,
          }}
          labels={{
            "Zoom in": "放大",
            "Zoom out": "缩小",
            Close: "关闭",
            Next: "下一张",
            Previous: "上一张",
          }}
          carousel={{ finite: slides.length <= 1, padding: "48px" }}
          controller={{ closeOnBackdropClick: true, closeOnPullDown: true }}
          animation={{ fade: 220, swipe: 280 }}
          className="goose-image-lightbox"
          toolbar={{
            buttons: [
              <button
                key="download"
                type="button"
                title="下载图片"
                aria-label="下载图片"
                onClick={handleDownload}
                className="yarl__button"
              >
                <Download size={18} strokeWidth={1.75} />
              </button>,
              <button
                key="copy"
                type="button"
                title="复制图片"
                aria-label="复制图片"
                onClick={handleCopy}
                className="yarl__button"
              >
                <Copy size={18} strokeWidth={1.75} />
              </button>,
              "close",
            ],
          }}
          render={{
            iconZoomIn: () => (
              <ZoomIn size={18} strokeWidth={1.75} aria-hidden="true" />
            ),
            iconZoomOut: () => (
              <ZoomOut size={18} strokeWidth={1.75} aria-hidden="true" />
            ),
            buttonClose: () => (
              <button
                key="close"
                type="button"
                title="关闭"
                aria-label="关闭"
                onClick={() => setOpen(false)}
                className="yarl__button"
              >
                <X size={18} strokeWidth={1.75} />
              </button>
            ),
            buttonPrev: slides.length <= 1 ? () => null : undefined,
            buttonNext: slides.length <= 1 ? () => null : undefined,
          }}
          styles={{
            container: { backgroundColor: "transparent" },
          }}
          on={{ view: ({ index: newIndex }) => setIndex(newIndex) }}
        />
      )}
    </>
  );
}
