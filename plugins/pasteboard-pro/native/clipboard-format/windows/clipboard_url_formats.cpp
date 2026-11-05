#include "clipboard_url_formats.h"

#include "clipboard_formats.h"
#include "../common/clipboard_url.h"

#include <windows.h>

#include <algorithm>
#include <charconv>
#include <limits>
#include <new>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace clipboard_format_probe {
namespace {

constexpr std::string_view kAnsiName = "UniformResourceLocator";
constexpr std::string_view kWideName = "UniformResourceLocatorW";
constexpr std::string_view kWideEncoding = "utf16le-url-null-terminated";
constexpr std::string_view kAnsiEncodingPrefix = "windows-acp-url-";

bool IsUrlKey(std::string_view key) {
  return key == "url-ansi" || key == "url-wide";
}


std::string AnsiEncoding(UINT code_page) {
  return std::string(kAnsiEncodingPrefix) + std::to_string(code_page);
}

bool ParseAnsiEncoding(std::string_view encoding, UINT* code_page) {
  if (code_page == nullptr ||
      encoding.substr(0, kAnsiEncodingPrefix.size()) != kAnsiEncodingPrefix) {
    return false;
  }
  const std::string_view number = encoding.substr(kAnsiEncodingPrefix.size());
  if (number.empty()) return false;
  unsigned int parsed = 0;
  const auto result = std::from_chars(number.data(), number.data() + number.size(),
                                      parsed);
  if (result.ec != std::errc{} || result.ptr != number.data() + number.size() ||
      parsed == 0 || std::to_string(parsed) != number) {
    return false;
  }
  *code_page = parsed;
  return true;
}

bool FlagsRequireZero(UINT code_page) {
  return code_page == 42 || code_page == 65000 ||
         code_page == 50220 || code_page == 50221 || code_page == 50222 ||
         code_page == 50225 || code_page == 50227 || code_page == 50229 ||
         (code_page >= 57002 && code_page <= 57011);
}

bool LosslessFallbackConversion(UINT code_page, const std::uint8_t* bytes,
                                int byte_count, const std::wstring& wide) {
  if (wide.find(static_cast<wchar_t>(0xfffd)) != std::wstring::npos ||
      wide.size() > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
    return false;
  }
  const bool no_default_parameters = code_page == CP_UTF8 || code_page == 65000;
  BOOL used_default = FALSE;
  BOOL* used_default_out = no_default_parameters ? nullptr : &used_default;
  const int required = WideCharToMultiByte(
      code_page, 0, wide.data(), static_cast<int>(wide.size()), nullptr, 0,
      nullptr, used_default_out);
  if (required != byte_count || used_default) return false;
  std::vector<char> encoded(static_cast<std::size_t>(required));
  used_default = FALSE;
  if (WideCharToMultiByte(
          code_page, 0, wide.data(), static_cast<int>(wide.size()),
          encoded.data(), required, nullptr, used_default_out) != required ||
      used_default) {
    return false;
  }
  return std::equal(encoded.begin(), encoded.end(),
                    reinterpret_cast<const char*>(bytes));
}

bool DecodeAcpUrl(const std::uint8_t* bytes, std::size_t size, UINT code_page,
                  std::u16string* text, clipboard_codecs::UrlLayout* layout) {
  if (text == nullptr || layout == nullptr || !IsValidCodePage(code_page) ||
      !clipboard_codecs::AnalyzeUrlAnsiBytes(bytes, size, layout) ||
      layout->content_bytes > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
    return false;
  }
  const DWORD flags = FlagsRequireZero(code_page) ? 0 : MB_ERR_INVALID_CHARS;
  const int byte_count = static_cast<int>(layout->content_bytes);
  const int wide_count = MultiByteToWideChar(
      code_page, flags, reinterpret_cast<const char*>(bytes), byte_count,
      nullptr, 0);
  if (wide_count <= 0) return false;
  try {
    std::wstring wide(static_cast<std::size_t>(wide_count), L'\0');
    if (MultiByteToWideChar(code_page, flags,
                            reinterpret_cast<const char*>(bytes), byte_count,
                            wide.data(), wide_count) != wide_count) {
      return false;
    }
    if (flags == 0 &&
        !LosslessFallbackConversion(code_page, bytes, byte_count, wide)) {
      return false;
    }
    text->assign(wide.begin(), wide.end());
  } catch (const std::bad_alloc&) {
    return false;
  }
  return clipboard_codecs::ValidateUrlText(*text) ==
         clipboard_codecs::UrlValidationResult::valid;
}

FormatPayload MakeUrlPayload(const char* key, const wchar_t* name, UINT id,
                             std::string encoding, const char* source) {
  FormatPayload payload;
  payload.key = key;
  payload.native_name = name;
  payload.format_id = id;
  payload.encoding = std::move(encoding);
  payload.fidelity = "representation-bytes-preserved";
  payload.source_format = source;
  payload.source_origin = "unknown";
  payload.materialization = "current-clipboard-format-bytes";
  return payload;
}

bool IdentityMatches(const FormatPayload& payload) {
  if (payload.source_origin != "unknown" ||
      payload.fidelity != "representation-bytes-preserved" ||
      payload.materialization != "current-clipboard-format-bytes") {
    return false;
  }
  if (payload.key == "url-wide") {
    return payload.native_name == L"UniformResourceLocatorW" &&
           payload.encoding == kWideEncoding &&
           payload.source_format == kWideName &&
           RegisteredFormatNamesEqual(StableFormatName(payload.format_id),
                                 kWideName);
  }
  if (payload.key == "url-ansi") {
    UINT code_page = 0;
    return payload.native_name == L"UniformResourceLocator" &&
           ParseAnsiEncoding(payload.encoding, &code_page) &&
           code_page == GetACP() && IsValidCodePage(code_page) &&
           payload.source_format == kAnsiName &&
           RegisteredFormatNamesEqual(StableFormatName(payload.format_id),
                                 kAnsiName);
  }
  return false;
}

}  // namespace

std::optional<FormatPayload> DescribeUrlFormat(UINT format_id) {
  const std::string stable_name = StableFormatName(format_id);
  if (RegisteredFormatNamesEqual(stable_name, kWideName)) {
    return MakeUrlPayload("url-wide", L"UniformResourceLocatorW", format_id,
                          std::string(kWideEncoding),
                          "UniformResourceLocatorW");
  }
  if (RegisteredFormatNamesEqual(stable_name, kAnsiName)) {
    const UINT code_page = GetACP();
    if (code_page == 0 || !IsValidCodePage(code_page)) return std::nullopt;
    return MakeUrlPayload("url-ansi", L"UniformResourceLocator", format_id,
                          AnsiEncoding(code_page),
                          "UniformResourceLocator");
  }
  return std::nullopt;
}

std::optional<std::size_t> UrlLogicalLength(const FormatPayload& payload) {
  if (payload.key == "url-wide") {
    if (payload.encoding != kWideEncoding) return std::nullopt;
    std::u16string text;
    clipboard_codecs::UrlLayout layout;
    if (!clipboard_codecs::AnalyzeUrlUtf16LE(payload.bytes.data(),
                                              payload.bytes.size(), &text,
                                              &layout) ||
        clipboard_codecs::ValidateUrlText(text) !=
            clipboard_codecs::UrlValidationResult::valid) {
      return std::nullopt;
    }
    return layout.logical_bytes;
  }
  if (payload.key == "url-ansi") {
    UINT code_page = 0;
    if (!ParseAnsiEncoding(payload.encoding, &code_page) ||
        code_page != GetACP() || !IsValidCodePage(code_page)) {
      return std::nullopt;
    }
    std::u16string text;
    clipboard_codecs::UrlLayout layout;
    return DecodeAcpUrl(payload.bytes.data(), payload.bytes.size(), code_page,
                        &text, &layout)
               ? std::optional<std::size_t>(layout.logical_bytes)
               : std::nullopt;
  }
  return std::nullopt;
}

std::size_t UrlFormatMaximum(std::string_view key) {
  return IsUrlKey(key) ? clipboard_codecs::kMaximumUrlAllocationBytes : 0;
}

bool IsUrlPayloadWellFormed(const FormatPayload& payload) {
  if (!IsUrlKey(payload.key) || !IdentityMatches(payload)) return false;
  const auto logical = UrlLogicalLength(payload);
  return logical.has_value() && *logical == payload.bytes.size();
}

}  // namespace clipboard_format_probe
