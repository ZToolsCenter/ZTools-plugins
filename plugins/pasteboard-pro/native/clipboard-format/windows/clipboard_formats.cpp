#include "clipboard_formats.h"
#include "clipboard_html.h"
#include "clipboard_png_wic.h"
#include "clipboard_tiff_wic.h"

#include "../common/clipboard_codecs.h"
#include "../common/clipboard_png.h"
#include "../common/clipboard_rtf.h"

#include <algorithm>
#include <climits>
#include <iterator>
#include <cstring>
#include <limits>
#include <new>
#include <string_view>
#include <utility>

namespace clipboard_format_probe {
namespace {

constexpr std::size_t kMaximumTextBytes = 2 * 1024 * 1024;
constexpr std::size_t kMaximumHtmlBytes = 8 * 1024 * 1024;
constexpr std::size_t kMaximumPngBytes = clipboard_codecs::kMaximumPngBytes;
constexpr std::size_t kMaximumRtfBytes = 2 * 1024 * 1024;

std::string Utf8FromWide(const std::wstring& input) {
  if (input.empty()) return {};
  const int required = WideCharToMultiByte(
      CP_UTF8, WC_ERR_INVALID_CHARS, input.data(),
      static_cast<int>(input.size()), nullptr, 0, nullptr, nullptr);
  if (required <= 0) return {};
  std::string output(static_cast<std::size_t>(required), '\0');
  if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, input.data(),
                          static_cast<int>(input.size()), output.data(),
                          required, nullptr, nullptr) != required) {
    return {};
  }
  return output;
}

std::optional<std::size_t> FindNullTerminatedTextLength(
    const std::uint8_t* bytes, std::size_t size) {
  if (size < sizeof(wchar_t) || size % sizeof(wchar_t) != 0 ||
      size > kMaximumTextBytes) {
    return std::nullopt;
  }

  for (std::size_t offset = 0; offset + 1 < size; offset += 2) {
    if (bytes[offset] != 0 || bytes[offset + 1] != 0) continue;
    for (std::size_t index = 0; index < offset; index += 2) {
      const std::uint16_t unit = static_cast<std::uint16_t>(bytes[index]) |
                                 (static_cast<std::uint16_t>(bytes[index + 1])
                                  << 8);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        if (index + 3 >= offset) return std::nullopt;
        const std::uint16_t low =
            static_cast<std::uint16_t>(bytes[index + 2]) |
            (static_cast<std::uint16_t>(bytes[index + 3]) << 8);
        if (low < 0xdc00 || low > 0xdfff) return std::nullopt;
        index += 2;
      } else if (unit >= 0xdc00 && unit <= 0xdfff) {
        return std::nullopt;
      }
    }
    return offset + 2;
  }
  return std::nullopt;
}

std::optional<std::size_t> LogicalLength(const FormatPayload& format,
                                         std::string* validation_error = nullptr) {
  if (format.key == "text") {
    return FindNullTerminatedTextLength(format.bytes.data(),
                                        format.bytes.size());
  }
  if (format.key == "html") {
    return FindHtmlPayloadLength(format.bytes.data(), format.bytes.size());
  }
  if (format.key == "rtf") {
    if (format.bytes.size() > kMaximumRtfBytes) return std::nullopt;
    RtfFraming framing;
    if (AnalyzeRtfFraming(format.bytes.data(), format.bytes.size(), &framing)) {
      return framing.logical_length;
    }
    return std::nullopt;
  }
  if (format.key == "png" || format.key == "image-png") {
    clipboard_codecs::PngLayout layout;
    if (!clipboard_codecs::AnalyzePng(format.bytes.data(), format.bytes.size(),
                                      &layout, validation_error)) {
      return std::nullopt;
    }
    return layout.logical_bytes;
  }
  return NativeLogicalLength(format);
}

std::size_t FormatMaximum(std::string_view key) {
  if (key == "text") return kMaximumTextBytes;
  if (key == "html") return kMaximumHtmlBytes;
  if (key == "rtf") return kMaximumRtfBytes;
  if (key == "png" || key == "image-png") return kMaximumPngBytes;
  return NativeFormatMaximum(key);
}

std::optional<FormatPayload> DescribeFormatInternal(
    UINT format_id, UINT unicode_id, UINT html_id, UINT rtf_id,
    UINT png_id, UINT image_png_id) {
  if (format_id == unicode_id) {
    return DescribeOsClipboardBytes("text", L"CF_UNICODETEXT", format_id,
                                    "utf16le-null-terminated",
                                    "CF_UNICODETEXT");
  }
  if (format_id == html_id) {
    return DescribeOsClipboardBytes("html", L"HTML Format", format_id,
                                    "cf-html-offset-format", "HTML Format");
  }
  if (format_id == rtf_id) {
    return DescribeOsClipboardBytes("rtf", L"Rich Text Format", format_id,
                                    "rtf-bytes", "Rich Text Format");
  }
  if (format_id == png_id) {
    return DescribeOsClipboardBytes("png", L"PNG", format_id,
                                    "png-bytes", "PNG");
  }
  if (format_id == image_png_id) {
    return DescribeOsClipboardBytes("image-png", L"image/png", format_id,
                                    "png-bytes", "image/png");
  }
  return DescribeNativeFormat(format_id);
}

bool CopyGlobalMemoryInternal(HANDLE handle, FormatPayload* format,
                              std::string* error) {
  if (handle == nullptr) {
    *error = "clipboard format returned a null handle";
    return false;
  }

  const SIZE_T allocation = GlobalSize(handle);
  const std::size_t maximum = FormatMaximum(format->key);
  if (allocation == 0 || maximum == 0 || allocation > maximum) {
    *error = "clipboard format allocation exceeds its limit";
    return false;
  }
  const auto* locked = static_cast<const std::uint8_t*>(GlobalLock(handle));
  if (locked == nullptr) {
    *error = "clipboard format memory could not be locked";
    return false;
  }

  try {
    format->bytes.assign(locked, locked + allocation);
  } catch (const std::bad_alloc&) {
    GlobalUnlock(handle);
    *error = "clipboard format copy exceeded available memory";
    return false;
  }
  std::string validation_error;
  const auto logical = LogicalLength(*format, &validation_error);
  if (!logical.has_value() || *logical > allocation) {
    format->bytes.clear();
    GlobalUnlock(handle);
    *error = validation_error.empty()
                 ? "clipboard format payload failed bounded validation"
                 : validation_error;
    return false;
  }
  format->bytes.resize(*logical);
  GlobalUnlock(handle);
  if (format->key == "file-list") {
    clipboard_codecs::DropFilesLayout drop;
    if (!clipboard_codecs::AnalyzeDropFiles(format->bytes.data(),
                                             format->bytes.size(), &drop)) {
      *error = "CF_HDROP failed bounded validation";
      return false;
    }
    format->encoding = drop.wide ? "utf16le-dropfiles" : "ansi-dropfiles";
    format->validation_code_page = drop.wide ? std::nullopt
                                             : std::optional<UINT>(GetACP());
  }
  return true;
}

std::unique_ptr<PreparedFormat> PrepareFormatInternal(
    const FormatPayload& format, std::string* error) {
  if (!IsPayloadWellFormed(format, error)) return nullptr;
  auto prepared = std::make_unique<PreparedFormat>();
  prepared->payload = format;
  if (format.key == "bitmap") {
    prepared->bitmap = CreateBitmapFromDib(format, error);
    if (prepared->bitmap == nullptr) return nullptr;
    prepared->storage = PreparedFormat::Storage::gdi_bitmap;
    return prepared;
  }
  if (format.key == "palette") {
    prepared->palette = CreatePaletteFromLogPalette(format, error);
    if (prepared->palette == nullptr) return nullptr;
    prepared->storage = PreparedFormat::Storage::gdi_palette;
    return prepared;
  }
  prepared->global_memory =
      GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, format.bytes.size());
  if (prepared->global_memory == nullptr) {
    *error = "GlobalAlloc failed for clipboard format";
    return nullptr;
  }
  prepared->storage = PreparedFormat::Storage::global_memory;

  auto* target =
      static_cast<std::uint8_t*>(GlobalLock(prepared->global_memory));
  if (target == nullptr) {
    *error = "clipboard format memory could not be locked for publication";
    return nullptr;
  }
  std::memcpy(target, format.bytes.data(), format.bytes.size());
  GlobalUnlock(prepared->global_memory);
  return prepared;
}

}  // namespace

std::optional<FormatPayload> DescribeFormat(
    UINT format_id, UINT unicode_id, UINT html_id, UINT rtf_id,
    UINT png_id, UINT image_png_id) {
  return DescribeFormatInternal(format_id, unicode_id, html_id, rtf_id,
                                png_id, image_png_id);
}

bool CopyGlobalMemory(HANDLE handle, FormatPayload* format,
                      std::string* error) {
  if (format == nullptr || error == nullptr) return false;
  return CopyGlobalMemoryInternal(handle, format, error);
}

std::unique_ptr<PreparedFormat> PrepareFormat(const FormatPayload& format,
                                              std::string* error) {
  if (error == nullptr) return nullptr;
  return PrepareFormatInternal(format, error);
}

bool RegisteredFormatNamesEqual(std::string_view left, std::string_view right) {
  if (left.size() != right.size()) return false;
  for (std::size_t index = 0; index < left.size(); ++index) {
    char a = left[index];
    char b = right[index];
    if (a >= 'A' && a <= 'Z') a = static_cast<char>(a + ('a' - 'A'));
    if (b >= 'A' && b <= 'Z') b = static_cast<char>(b + ('a' - 'A'));
    if (a != b) return false;
  }
  return true;
}

std::string StableFormatName(UINT format_id) {
  if (format_id == CF_TEXT) return "CF_TEXT";
  if (format_id == CF_BITMAP) return "CF_BITMAP";
  if (format_id == CF_METAFILEPICT) return "CF_METAFILEPICT";
  if (format_id == CF_SYLK) return "CF_SYLK";
  if (format_id == CF_DIF) return "CF_DIF";
  if (format_id == CF_TIFF) return "CF_TIFF";
  if (format_id == CF_OEMTEXT) return "CF_OEMTEXT";
  if (format_id == CF_DIB) return "CF_DIB";
  if (format_id == CF_PALETTE) return "CF_PALETTE";
  if (format_id == CF_PENDATA) return "CF_PENDATA";
  if (format_id == CF_RIFF) return "CF_RIFF";
  if (format_id == CF_WAVE) return "CF_WAVE";
  if (format_id == CF_UNICODETEXT) return "CF_UNICODETEXT";
  if (format_id == CF_ENHMETAFILE) return "CF_ENHMETAFILE";
  if (format_id == CF_HDROP) return "CF_HDROP";
  if (format_id == CF_LOCALE) return "CF_LOCALE";
  if (format_id == CF_DIBV5) return "CF_DIBV5";
  wchar_t name[256]{};
  const int length = GetClipboardFormatNameW(
      format_id, name, static_cast<int>(std::size(name)));
  return length > 0 ? Utf8FromWide(std::wstring(name, length)) : "unknown";
}

std::string StatusName(OperationStatus status) {
  switch (status) {
    case OperationStatus::committed:
      return "committed";
    case OperationStatus::partial_write:
      return "partial-write";
    case OperationStatus::partial_capture:
      return "partial-capture";
    case OperationStatus::superseded:
      return "superseded";
    case OperationStatus::invalid_request:
      return "invalid-request";
    case OperationStatus::unsupported_format:
      return "unsupported-format";
    case OperationStatus::clipboard_busy:
      return "clipboard-busy";
    case OperationStatus::read_failed:
      return "read-failed";
    case OperationStatus::write_failed:
      return "write-failed";
    case OperationStatus::policy_denied:
      return "policy-denied";
    case OperationStatus::file_reference_unavailable:
      return "file-reference-unavailable";
    case OperationStatus::session_failed:
      return "session-failed";
  }
  return "unknown";
}

bool IsPayloadWellFormed(const FormatPayload& format, std::string* error) {
  if (format.bytes.empty() || format.bytes.size() > FormatMaximum(format.key)) {
    if (error != nullptr) *error = "format byte length is empty or too large";
    return false;
  }
  if (format.format_id == 0 || format.key.empty() ||
      StableFormatName(format.format_id) == "unknown") {
    if (error != nullptr) *error = "format identity is not registered";
    return false;
  }

  std::string logical_error;
  const auto logical_length = LogicalLength(format, &logical_error);
  if (!logical_length.has_value() || *logical_length != format.bytes.size()) {
    if (error != nullptr) {
      *error = logical_error.empty() ? "format payload failed validation"
                                     : logical_error;
    }
    return false;
  }

  const bool identity_matches =
      IsOsClipboardPayloadWellFormed(format) ||
      IsNativePayloadWellFormed(format);
  if (!identity_matches) {
    if (error != nullptr) *error = "format identity is not allowlisted";
    return false;
  }
  if (format.key == "png" || format.key == "image-png") {
    if (!ValidatePngPixels(format.bytes, error)) return false;
  }
  if (format.key == "tiff" && !ValidateTiffPixels(format.bytes, error)) return false;
  return true;
}

}  // namespace clipboard_format_probe
