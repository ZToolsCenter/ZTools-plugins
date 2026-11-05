#include "clipboard_formats.h"
#include "clipboard_url_formats.h"

#include "../common/clipboard_codecs.h"
#include "../common/clipboard_palette.h"
#include "../common/clipboard_tiff.h"

#include <windows.h>

#include <utility>

namespace clipboard_format_probe {
namespace {

FormatPayload NativePayload(std::string key, const wchar_t* name, UINT id,
                            std::string encoding,
                            std::string source_format,
                            std::string fidelity =
                                "representation-bytes-preserved") {
  FormatPayload payload;
  payload.key = std::move(key);
  payload.native_name = name;
  payload.format_id = id;
  payload.encoding = std::move(encoding);
  payload.fidelity = std::move(fidelity);
  payload.source_format = std::move(source_format);
  payload.source_origin = "unknown";
  payload.materialization = "current-clipboard-format-bytes";
  return payload;
}

}  // namespace

std::optional<FormatPayload> DescribeNativeFormat(UINT id) {
  if (id == CF_TIFF) {
    return NativePayload("tiff", L"CF_TIFF", id, "tiff6-bytes", "CF_TIFF");
  }
  if (id == CF_DIB) {
    return NativePayload("dib", L"CF_DIB", id, "windows-dib", "CF_DIB");
  }
  if (id == CF_DIBV5) {
    return NativePayload("dibv5", L"CF_DIBV5", id, "windows-dibv5",
                         "CF_DIBV5");
  }
  if (id == CF_BITMAP) {
    return NativePayload("bitmap", L"CF_BITMAP", id, "dib24-rendered",
                         "CF_BITMAP", "visible-rgb-compatible");
  }
  if (id == CF_PALETTE) {
    return NativePayload("palette", L"CF_PALETTE", id, "logpalette-v0300",
                         "CF_PALETTE", "palette-entries-preserved");
  }
  if (id == CF_HDROP) {
    return NativePayload("file-list", L"CF_HDROP", id, "dropfiles",
                         "CF_HDROP");
  }
  if (id == CF_TEXT) {
    return NativePayload("text-acp", L"CF_TEXT", id, "windows-acp-raw",
                         "CF_TEXT");
  }
  if (id == CF_OEMTEXT) {
    return NativePayload("text-oem", L"CF_OEMTEXT", id, "windows-oemcp-raw",
                         "CF_OEMTEXT");
  }
  if (id == CF_LOCALE) {
    return NativePayload("locale", L"CF_LOCALE", id, "windows-lcid-le",
                         "CF_LOCALE");
  }
  if (auto url = DescribeUrlFormat(id); url.has_value()) return url;
  return std::nullopt;
}

FormatPayload DescribeOsClipboardBytes(std::string key, const wchar_t* name,
                                      UINT id, std::string encoding,
                                      std::string source_format) {
  return NativePayload(std::move(key), name, id, std::move(encoding),
                       std::move(source_format));
}

bool IsOsClipboardPayloadWellFormed(const FormatPayload& payload) {
  const wchar_t* expected_name = nullptr;
  const char* expected_encoding = nullptr;
  const char* expected_source = nullptr;
  if (payload.key == "text") {
    expected_name = L"CF_UNICODETEXT";
    expected_encoding = "utf16le-null-terminated";
    expected_source = "CF_UNICODETEXT";
    if (payload.format_id != CF_UNICODETEXT) return false;
  } else if (payload.key == "html") {
    expected_name = L"HTML Format";
    expected_encoding = "cf-html-offset-format";
    expected_source = "HTML Format";
  } else if (payload.key == "rtf") {
    expected_name = L"Rich Text Format";
    expected_encoding = "rtf-bytes";
    expected_source = "Rich Text Format";
  } else if (payload.key == "png") {
    expected_name = L"PNG";
    expected_encoding = "png-bytes";
    expected_source = "PNG";
  } else if (payload.key == "image-png") {
    expected_name = L"image/png";
    expected_encoding = "png-bytes";
    expected_source = "image/png";
  } else {
    return false;
  }
  return payload.native_name == expected_name &&
         payload.encoding == expected_encoding &&
         payload.source_format == expected_source &&
         payload.source_origin == "unknown" &&
         payload.fidelity == "representation-bytes-preserved" &&
         payload.materialization == "current-clipboard-format-bytes" &&
         RegisteredFormatNamesEqual(StableFormatName(payload.format_id), expected_source);
}

std::optional<std::size_t> NativeLogicalLength(const FormatPayload& payload) {
  using namespace clipboard_codecs;
  if (payload.key == "url-ansi" || payload.key == "url-wide") {
    return UrlLogicalLength(payload);
  }
  if (payload.key == "tiff") {
    TiffLayout tiff;
    return AnalyzeTiff(payload.bytes.data(), payload.bytes.size(), &tiff)
        ? std::optional<std::size_t>(tiff.logical_bytes) : std::nullopt;
  }
  DibLayout dib;
  DropFilesLayout drop;
  if (payload.key == "dib" || payload.key == "dibv5" ||
      payload.key == "bitmap") {
    if (!AnalyzeDib(payload.bytes.data(), payload.bytes.size(), &dib)) {
      return std::nullopt;
    }
    if (payload.key == "dibv5" && dib.header_bytes != 124) {
      return std::nullopt;
    }
    return dib.logical_bytes;
  }
  if (payload.key == "file-list") {
    if (!AnalyzeDropFiles(payload.bytes.data(), payload.bytes.size(), &drop)) {
      return std::nullopt;
    }
    return drop.logical_bytes;
  }
  if (payload.key == "palette") {
    clipboard_codecs::PaletteLayout palette;
    return clipboard_codecs::AnalyzePalette(payload.bytes.data(),
                                             payload.bytes.size(), &palette)
               ? std::optional<std::size_t>(palette.logical_bytes)
               : std::nullopt;
  }
  if (payload.key == "text-acp" || payload.key == "text-oem") {
    return LogicalAnsiTextBytes(payload.bytes.data(), payload.bytes.size());
  }
  if (payload.key == "locale") {
    std::uint32_t locale_id = 0;
    return AnalyzeLocale(payload.bytes.data(), payload.bytes.size(), &locale_id)
               ? std::optional<std::size_t>(sizeof(locale_id))
               : std::nullopt;
  }
  return std::nullopt;
}

std::size_t NativeFormatMaximum(std::string_view key) {
  if (key == "url-ansi" || key == "url-wide") return UrlFormatMaximum(key);
  if (key == "tiff") return clipboard_codecs::kMaximumTiffBytes;
  if (key == "dib" || key == "dibv5" || key == "bitmap") {
    return clipboard_codecs::kMaximumDibBytes;
  }
  if (key == "file-list") {
    return clipboard_codecs::kMaximumDropFilesBytes;
  }
  if (key == "palette") return clipboard_codecs::kMaximumPaletteBytes;
  if (key == "text-acp" || key == "text-oem") return 2 * 1024 * 1024;
  if (key == "locale") return 64 * 1024;
  return 0;
}

bool IsNativePayloadWellFormed(const FormatPayload& payload) {
  if (payload.key == "url-ansi" || payload.key == "url-wide") {
    return IsUrlPayloadWellFormed(payload);
  }
  if (payload.key == "tiff") {
    clipboard_codecs::TiffLayout tiff;
    return payload.format_id == CF_TIFF && payload.native_name == L"CF_TIFF" &&
        payload.encoding == "tiff6-bytes" && !payload.validation_code_page &&
        payload.source_format == "CF_TIFF" && payload.source_origin == "unknown" &&
        payload.fidelity == "representation-bytes-preserved" &&
        payload.materialization == "current-clipboard-format-bytes" &&
        clipboard_codecs::AnalyzeTiff(payload.bytes.data(), payload.bytes.size(), &tiff) &&
        tiff.logical_bytes == payload.bytes.size();
  }
  const std::string expected_encoding =
      payload.key == "dib"       ? "windows-dib"
      : payload.key == "dibv5"   ? "windows-dibv5"
      : payload.key == "bitmap"  ? "dib24-rendered"
      : payload.key == "file-list" ? "dropfiles"
      : payload.key == "palette" ? "logpalette-v0300"
      : payload.key == "text-acp" ? "windows-acp-raw"
      : payload.key == "text-oem" ? "windows-oemcp-raw"
      : payload.key == "locale" ? "windows-lcid-le"
                                   : "";
  const wchar_t* expected_name =
      payload.key == "dib" ? L"CF_DIB"
      : payload.key == "dibv5" ? L"CF_DIBV5"
      : payload.key == "bitmap" ? L"CF_BITMAP"
      : payload.key == "file-list" ? L"CF_HDROP"
      : payload.key == "palette" ? L"CF_PALETTE"
      : payload.key == "text-acp" ? L"CF_TEXT"
      : payload.key == "text-oem" ? L"CF_OEMTEXT"
      : payload.key == "locale" ? L"CF_LOCALE"
                                  : L"";
  const char* expected_source =
      payload.key == "dib" ? "CF_DIB"
      : payload.key == "dibv5" ? "CF_DIBV5"
      : payload.key == "bitmap" ? "CF_BITMAP"
      : payload.key == "file-list" ? "CF_HDROP"
      : payload.key == "palette" ? "CF_PALETTE"
      : payload.key == "text-acp" ? "CF_TEXT"
      : payload.key == "text-oem" ? "CF_OEMTEXT"
      : payload.key == "locale" ? "CF_LOCALE"
                                  : "";
  bool file_list_encoding = false;
  if (payload.key == "file-list") {
    clipboard_codecs::DropFilesLayout layout;
    if (!clipboard_codecs::AnalyzeDropFiles(payload.bytes.data(),
                                            payload.bytes.size(), &layout)) {
      return false;
    }
    file_list_encoding = payload.encoding ==
                         (layout.wide ? "utf16le-dropfiles"
                                      : "ansi-dropfiles");
  }
  const UINT expected_id =
      payload.key == "dib" ? CF_DIB
      : payload.key == "dibv5" ? CF_DIBV5
      : payload.key == "bitmap" ? CF_BITMAP
      : payload.key == "file-list" ? CF_HDROP
      : payload.key == "palette" ? CF_PALETTE
      : payload.key == "text-acp" ? CF_TEXT
      : payload.key == "text-oem" ? CF_OEMTEXT
      : payload.key == "locale" ? CF_LOCALE
                                  : 0;
  if (expected_encoding[0] == '\0' ||
      (payload.key == "file-list" ? !file_list_encoding
                                   : payload.encoding != expected_encoding) ||
      payload.native_name != expected_name ||
      payload.source_format != expected_source ||
      payload.format_id != expected_id || payload.source_origin != "unknown") {
    return false;
  }
  if (payload.key == "bitmap") {
    clipboard_codecs::DibLayout layout;
    return payload.fidelity == "visible-rgb-compatible" &&
           payload.materialization == "win32-getdibits-24bpp-top-down" &&
           clipboard_codecs::AnalyzeDib(payload.bytes.data(),
                                        payload.bytes.size(), &layout) &&
           layout.header_bytes == 40 && layout.bits_per_pixel == 24 &&
           layout.compression == 0 && layout.top_down && !layout.has_profile &&
           layout.logical_bytes == payload.bytes.size();
  }
  if (payload.key == "palette") {
    return payload.fidelity == "palette-entries-preserved" &&
           payload.materialization ==
               "win32-getpaletteentries-logpalette-v0300";
  }
  return payload.fidelity == "representation-bytes-preserved" &&
         payload.materialization == "current-clipboard-format-bytes";
}

}  // namespace clipboard_format_probe
