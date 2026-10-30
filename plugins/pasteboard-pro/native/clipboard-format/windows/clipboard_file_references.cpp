#include "clipboard_file_references.h"

#include "clipboard_file_reference_paths.h"
#include "clipboard_formats.h"
#include "../common/clipboard_codecs.h"

#include <cstdint>
#include <limits>
#include <string>
#include <string_view>
#include <utility>
#include <vector>
#include <windows.h>

namespace clipboard_format_probe {
namespace {

bool DecodeAcpPath(std::string_view bytes, UINT code_page,
                   std::wstring* output) {
  if (output == nullptr || bytes.empty() ||
      bytes.size() > static_cast<std::size_t>(std::numeric_limits<int>::max()) ||
      code_page == 0 || !IsValidCodePage(code_page)) {
    return false;
  }
  const int count = static_cast<int>(bytes.size());
  const bool strict_unicode_page =
      code_page == CP_UTF8 || code_page == 54936;  // GB18030.
  const DWORD decode_flags = strict_unicode_page ? MB_ERR_INVALID_CHARS : 0;
  const int required = MultiByteToWideChar(
      code_page, decode_flags, bytes.data(), count, nullptr, 0);
  if (required <= 0) return false;
  std::wstring decoded(static_cast<std::size_t>(required), L'\0');
  if (MultiByteToWideChar(code_page, decode_flags, bytes.data(), count,
                          decoded.data(), required) != required) {
    return false;
  }

  // Accept only a byte-exact round trip; the helper ACP is not producer
  // provenance and must not turn an ambiguous byte sequence into another path.
  BOOL used_default = FALSE;
  const bool code_page_has_default_character =
      code_page != CP_UTF8 && code_page != 54936 && code_page != 65000;
  const DWORD encode_flags = code_page_has_default_character
                                 ? WC_NO_BEST_FIT_CHARS
                                 : 0;
  BOOL* used_default_out = code_page_has_default_character
                               ? &used_default
                               : nullptr;
  const int encoded_length = WideCharToMultiByte(
      code_page, encode_flags, decoded.data(), required, nullptr, 0, nullptr,
      used_default_out);
  if (encoded_length != count || used_default) return false;
  std::string encoded(static_cast<std::size_t>(encoded_length), '\0');
  used_default = FALSE;
  if (WideCharToMultiByte(code_page, encode_flags, decoded.data(), required,
                          encoded.data(), encoded_length, nullptr,
                          used_default_out) != encoded_length ||
      used_default || encoded != bytes) {
    return false;
  }
  *output = std::move(decoded);
  return true;
}

bool FileListPaths(const FormatPayload& payload,
                   std::vector<std::wstring>* paths) {
  if (paths == nullptr || payload.key != "file-list" ||
      payload.native_name != L"CF_HDROP" || payload.format_id != CF_HDROP ||
      payload.source_format != "CF_HDROP" ||
      payload.source_origin != "unknown" ||
      payload.fidelity != "representation-bytes-preserved" ||
      payload.materialization != "current-clipboard-format-bytes") {
    return false;
  }
  const UINT validation_code_page = GetACP();
  if (payload.encoding == "utf16le-dropfiles") {
    if (payload.validation_code_page.has_value()) return false;
  } else if (!payload.validation_code_page.has_value() ||
             *payload.validation_code_page != validation_code_page) {
    return false;
  }
  clipboard_codecs::DropFilesLayout layout;
  if (!clipboard_codecs::AnalyzeDropFiles(payload.bytes.data(),
                                           payload.bytes.size(), &layout) ||
      layout.logical_bytes != payload.bytes.size() ||
      payload.encoding != (layout.wide ? "utf16le-dropfiles"
                                       : "ansi-dropfiles")) {
    return false;
  }

  std::size_t cursor = layout.files_offset;
  paths->clear();
  paths->reserve(layout.file_count);
  for (std::size_t index = 0; index < layout.file_count; ++index) {
    if (layout.wide) {
      std::wstring path;
      while (cursor + 1 < layout.logical_bytes) {
        const std::uint16_t unit = payload.bytes[cursor] |
            (static_cast<std::uint16_t>(payload.bytes[cursor + 1]) << 8);
        cursor += 2;
        if (unit == 0) break;
        path.push_back(static_cast<wchar_t>(unit));
      }
      if (path.empty()) return false;
      paths->push_back(std::move(path));
    } else {
      std::string path_bytes;
      while (cursor < layout.logical_bytes && payload.bytes[cursor] != 0) {
        path_bytes.push_back(static_cast<char>(payload.bytes[cursor++]));
      }
      if (cursor >= layout.logical_bytes || payload.bytes[cursor++] != 0) {
        return false;
      }
      std::wstring path;
      if (!DecodeAcpPath(path_bytes, validation_code_page, &path)) return false;
      paths->push_back(std::move(path));
    }
  }
  return paths->size() == layout.file_count;
}

void Fail(std::string* error) {
  if (error != nullptr) *error = "file-reference-unavailable";
}

}  // namespace

bool FileReferencesAvailableForPublish(
    const std::vector<FormatPayload>& formats, std::string* error,
    const FileReferenceAccessProbe& access_probe) {
  if (error != nullptr) error->clear();
  try {
    for (const auto& format : formats) {
      if (format.format_id != CF_HDROP && format.key != "file-list") continue;

      std::vector<std::wstring> paths;
      if (!FileListPaths(format, &paths)) {
        Fail(error);
        return false;
      }
      for (const auto& path : paths) {
        if (!IsSafeFilesystemPath(path)) {
          Fail(error);
          return false;
        }
        bool is_directory = false;
        const bool accessible = FilesystemReferenceAccessible(
            path, !access_probe, &is_directory);
        if (!accessible ||
            (access_probe && !access_probe(path, is_directory))) {
          Fail(error);
          return false;
        }
      }
    }
  } catch (...) {
    Fail(error);
    return false;
  }
  return true;
}

}  // namespace clipboard_format_probe
