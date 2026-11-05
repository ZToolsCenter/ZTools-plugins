#pragma once

#include "clipboard_probe.h"

#include <memory>
#include <string_view>

namespace clipboard_format_probe {

inline constexpr std::size_t kMaximumFormats = 32;
inline constexpr std::size_t kMaximumClipboardBytes = 20 * 1024 * 1024;

struct PreparedFormat {
  enum class Storage { none, global_memory, gdi_bitmap, gdi_palette };

  FormatPayload payload;
  HGLOBAL global_memory = nullptr;
  HBITMAP bitmap = nullptr;
  HPALETTE palette = nullptr;
  Storage storage = Storage::none;
  bool transferred = false;

  // Private G0 lifetime instrumentation; never exposed through a host bridge.
  using ReleaseObserver = void (*)(Storage, HANDLE, bool, bool, bool, void*) noexcept;
  ReleaseObserver release_observer_for_testing = nullptr;
  void* release_observer_context_for_testing = nullptr;

  PreparedFormat() = default;
  PreparedFormat(const PreparedFormat&) = delete;
  PreparedFormat& operator=(const PreparedFormat&) = delete;
  ~PreparedFormat();

  HANDLE ClipboardHandle() const;
  void MarkTransferred();
};

std::optional<FormatPayload> DescribeFormat(
    UINT format_id, UINT unicode_id, UINT html_id, UINT rtf_id,
    UINT png_id, UINT image_png_id);
bool CopyGlobalMemory(HANDLE handle, FormatPayload* format,
                      std::string* error);
std::unique_ptr<PreparedFormat> PrepareFormat(const FormatPayload& format,
                                              std::string* error);
std::optional<FormatPayload> DescribeNativeFormat(UINT format_id);
FormatPayload DescribeOsClipboardBytes(std::string key, const wchar_t* name,
                                      UINT format_id, std::string encoding,
                                      std::string source_format);
bool IsOsClipboardPayloadWellFormed(const FormatPayload& format);
std::optional<std::size_t> NativeLogicalLength(const FormatPayload& format);
std::size_t NativeFormatMaximum(std::string_view key);
bool IsNativePayloadWellFormed(const FormatPayload& format);
bool CopyBitmapToDib(HBITMAP bitmap, FormatPayload* format,
                     std::string* error);
HBITMAP CreateBitmapFromDib(const FormatPayload& format,
                            std::string* error);
bool CopyPaletteToLogPalette(HPALETTE palette, FormatPayload* format,
                             std::string* error);
HPALETTE CreatePaletteFromLogPalette(const FormatPayload& format,
                                     std::string* error);

std::string StableFormatName(UINT format_id);
bool RegisteredFormatNamesEqual(std::string_view left, std::string_view right);
std::string StatusName(OperationStatus status);
bool IsPayloadWellFormed(const FormatPayload& format, std::string* error);

}  // namespace clipboard_format_probe
