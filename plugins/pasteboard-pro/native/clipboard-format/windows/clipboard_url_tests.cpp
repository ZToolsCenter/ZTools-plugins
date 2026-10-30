#include "clipboard_url_tests.h"

#include "clipboard_formats.h"
#include "clipboard_url_formats.h"

#include <windows.h>
#include <shlobj.h>

#include <algorithm>
#include <climits>
#include <cstdint>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace clipboard_format_probe {
namespace {

constexpr const char* kCaseFormatNames = "url-format-name-id-binding";
constexpr const char* kCaseWideRoundTrip = "url-wide-unicode-percent-roundtrip";
constexpr const char* kCaseAnsiRoundTrip = "url-ansi-acp-nonascii-roundtrip";
constexpr const char* kCaseAcpValidation = "url-ansi-acp-validation";
constexpr const char* kCaseAcpMismatch = "url-ansi-acp-change-rejected";
constexpr const char* kCaseRawUri = "url-raw-uri-retention";
constexpr const char* kCaseIdMismatch = "url-format-id-mismatch-rejected";

bool EqualAsciiInsensitive(std::string_view left, std::string_view right) {
  if (left.size() != right.size()) return false;
  for (std::size_t index = 0; index < left.size(); ++index) {
    char a = left[index];
    char b = right[index];
    if (a >= 'A' && a <= 'Z') a += 'a' - 'A';
    if (b >= 'A' && b <= 'Z') b += 'a' - 'A';
    if (a != b) return false;
  }
  return true;
}

void Add(std::vector<CaseResult>* cases, const char* id, const char* status,
         std::string detail) {
  cases->push_back(CaseResult{id, status, std::move(detail)});
}

std::vector<CaseResult> AllNotRun(const char* detail) {
  std::vector<CaseResult> results;
  results.reserve(7);
  Add(&results, kCaseFormatNames, "not-run", detail);
  Add(&results, kCaseWideRoundTrip, "not-run", detail);
  Add(&results, kCaseAnsiRoundTrip, "not-run", detail);
  Add(&results, kCaseAcpValidation, "not-run", detail);
  Add(&results, kCaseAcpMismatch, "not-run", detail);
  Add(&results, kCaseRawUri, "not-run", detail);
  Add(&results, kCaseIdMismatch, "not-run", detail);
  return results;
}

std::vector<std::uint8_t> Utf16Le(std::u16string_view text) {
  std::vector<std::uint8_t> bytes;
  bytes.reserve((text.size() + 1) * 2);
  for (const char16_t unit : text) {
    bytes.push_back(static_cast<std::uint8_t>(unit & 0xff));
    bytes.push_back(static_cast<std::uint8_t>(unit >> 8));
  }
  bytes.push_back(0);
  bytes.push_back(0);
  return bytes;
}

bool FlagsRequireZero(UINT code_page) {
  return code_page == 42 || code_page == 65000 || code_page == 50220 ||
         code_page == 50221 || code_page == 50222 || code_page == 50225 ||
         code_page == 50227 || code_page == 50229 ||
         (code_page >= 57002 && code_page <= 57011);
}

bool EncodeAcp(std::u16string_view text, UINT code_page,
               std::vector<std::uint8_t>* bytes) {
  if (bytes == nullptr || text.empty() ||
      text.size() > static_cast<std::size_t>(INT_MAX) ||
      !IsValidCodePage(code_page)) {
    return false;
  }
  const bool unicode_cp = code_page == CP_UTF8 || code_page == 54936;
  const DWORD flags = unicode_cp
                          ? WC_ERR_INVALID_CHARS
                          : FlagsRequireZero(code_page) ? 0
                                                        : WC_NO_BEST_FIT_CHARS;
  BOOL used_default = FALSE;
  BOOL* used_default_out = unicode_cp || code_page == 65000
                               ? nullptr
                               : &used_default;
  const int char_count = static_cast<int>(text.size());
  const int required = WideCharToMultiByte(
      code_page, flags, reinterpret_cast<LPCWCH>(text.data()), char_count,
      nullptr, 0, nullptr, used_default_out);
  if (required <= 0 || used_default) return false;
  std::vector<std::uint8_t> converted(static_cast<std::size_t>(required));
  used_default = FALSE;
  if (WideCharToMultiByte(
          code_page, flags, reinterpret_cast<LPCWCH>(text.data()), char_count,
          reinterpret_cast<LPSTR>(converted.data()), required, nullptr,
          used_default_out) != required ||
      used_default) {
    return false;
  }
  bytes->assign(converted.begin(), converted.end());
  bytes->push_back(0);
  return true;
}

FormatPayload MakeWidePayload(UINT id, std::u16string_view text) {
  FormatPayload payload;
  payload.key = "url-wide";
  payload.native_name = L"UniformResourceLocatorW";
  payload.format_id = id;
  payload.bytes = Utf16Le(text);
  payload.encoding = "utf16le-url-null-terminated";
  payload.fidelity = "representation-bytes-preserved";
  payload.source_format = "UniformResourceLocatorW";
  payload.source_origin = "unknown";
  payload.materialization = "current-clipboard-format-bytes";
  return payload;
}

FormatPayload MakeAnsiPayload(UINT id, UINT code_page,
                              std::vector<std::uint8_t> bytes) {
  FormatPayload payload;
  payload.key = "url-ansi";
  payload.native_name = L"UniformResourceLocator";
  payload.format_id = id;
  payload.bytes = std::move(bytes);
  payload.encoding = "windows-acp-url-" + std::to_string(code_page);
  payload.fidelity = "representation-bytes-preserved";
  payload.source_format = "UniformResourceLocator";
  payload.source_origin = "unknown";
  payload.materialization = "current-clipboard-format-bytes";
  return payload;
}

bool MakeNonAsciiAnsiSample(UINT id, UINT code_page, FormatPayload* payload) {
  const std::u16string prefix = u"https://example.invalid/";
  const std::u16string suffix = u"?q=%E9%9B%AA";
  const std::u16string candidates[] = {u"caf\u00e9", u"caf\u00f1", u"\u00e9",
                                       u"\u0416", u"\u03a9", u"\u4e2d",
                                       u"\u3042"};
  for (const auto& candidate : candidates) {
    std::u16string url = prefix + candidate + suffix;
    std::vector<std::uint8_t> encoded;
    if (!EncodeAcp(url, code_page, &encoded) ||
        std::none_of(encoded.begin(), encoded.end() - 1,
                     [](std::uint8_t byte) { return byte >= 0x80; })) {
      continue;
    }
    *payload = MakeAnsiPayload(id, code_page, std::move(encoded));
    return true;
  }
  return false;
}

bool MakeMalformedAcpSample(UINT id, UINT code_page, FormatPayload* payload) {
  std::uint8_t invalid_byte = 0;
  if (code_page == CP_UTF8) {
    invalid_byte = 0xc3;  // Incomplete UTF-8 sequence.
  } else if (code_page == 54936) {
    invalid_byte = 0x81;  // Incomplete GB18030 sequence.
  } else {
    CPINFOEXW info{};
    if (!GetCPInfoExW(code_page, 0, &info)) return false;
    for (std::size_t index = 0; index + 1 < sizeof(info.LeadByte); index += 2) {
      const auto first = info.LeadByte[index];
      const auto last = info.LeadByte[index + 1];
      if (first == 0 && last == 0) break;
      if (first != 0) {
        invalid_byte = first;  // Orphan DBCS lead byte.
        break;
      }
    }
    if (invalid_byte == 0) return false;
  }
  std::vector<std::uint8_t> bytes = {
      'h', 't', 't', 'p', 's', ':', '/', '/', 'e', 'x', 'a', 'm', 'p', 'l', 'e',
      '.', 'i', 'n', 'v', 'a', 'l', 'i', 'd', '/', invalid_byte, 0};
  *payload = MakeAnsiPayload(id, code_page, std::move(bytes));
  return true;
}

bool RoundTripsEverySingleByte(UINT code_page) {
  const bool flags_zero = code_page == 42 || code_page == 65000 ||
      code_page == 50220 || code_page == 50221 || code_page == 50222 ||
      code_page == 50225 || code_page == 50227 || code_page == 50229 ||
      (code_page >= 57002 && code_page <= 57011);
  const DWORD decode_flags = flags_zero ? 0 : MB_ERR_INVALID_CHARS;
  const DWORD encode_flags = flags_zero ? 0 : WC_NO_BEST_FIT_CHARS;
  for (unsigned int value = 1; value <= 0xff; ++value) {
    const char input = static_cast<char>(value);
    wchar_t wide = L'\0';
    if (MultiByteToWideChar(code_page, decode_flags, &input, 1, &wide, 1) != 1) {
      return false;
    }
    char encoded[8]{};
    BOOL used_default = FALSE;
    BOOL* used_default_out = code_page == 65000 ? nullptr : &used_default;
    const int count = WideCharToMultiByte(
        code_page, encode_flags, &wide, 1, encoded,
        static_cast<int>(sizeof(encoded)), nullptr, used_default_out);
    if (count != 1 || used_default || encoded[0] != input) return false;
  }
  return true;
}

bool RunAcpValidation(UINT id, UINT code_page, bool* not_run,
                      std::string* detail) {
  if (not_run == nullptr || detail == nullptr) return false;
  *not_run = false;
  FormatPayload malformed;
  if (MakeMalformedAcpSample(id, code_page, &malformed)) {
    const bool rejected = !NativeLogicalLength(malformed).has_value() &&
                          !IsPayloadWellFormed(malformed, nullptr);
    *detail = rejected
        ? "UTF-8, GB18030, or DBCS incomplete sequence was rejected by strict ACP decoding"
        : "incomplete ACP multibyte sequence passed URL validation";
    return rejected;
  }
  if (code_page == CP_UTF8 || code_page == 54936) {
    *detail = "could not construct an incomplete UTF-8 or GB18030 sequence";
    return false;
  }

  CPINFOEXW info{};
  if (!GetCPInfoExW(code_page, 0, &info)) {
    *detail = "GetCPInfoExW could not describe the active ACP";
    return false;
  }
  if (info.MaxCharSize != 1) {
    *not_run = true;
    *detail = "active ACP is multibyte but no incomplete sequence fixture was available";
    return false;
  }

  std::vector<std::uint8_t> control_url = {
      'h', 't', 't', 'p', 's', ':', '/', '/', 'e', 'x', 'a', 'm', 'p', 'l', 'e',
      '.', 'i', 'n', 'v', 'a', 'l', 'i', 'd', '/', 'o', 'k', '\r', 'b', 'a', 'd', 0};
  FormatPayload control = MakeAnsiPayload(id, code_page, std::move(control_url));
  const bool control_rejected = !NativeLogicalLength(control).has_value() &&
                                !IsPayloadWellFormed(control, nullptr);
  const bool all_bytes_round_trip = RoundTripsEverySingleByte(code_page);
  const bool passed = control_rejected && all_bytes_round_trip;
  *detail = passed
      ? "SBCS ACP rejected a CR-bearing URL and losslessly mapped every non-NUL byte"
      : "SBCS validation failed control rejection or one of 255 byte round-trips";
  return passed;
}

bool RoundTrip(Win32ClipboardAdapter* adapter, const FormatPayload& expected) {
  const OperationResult published =
      adapter->Publish(adapter->Revision(), {expected});
  if (published.status != OperationStatus::committed ||
      published.written_keys != std::vector<std::string>{expected.key}) {
    return false;
  }
  ClipboardSnapshot snapshot;
  const OperationResult captured =
      adapter->Capture(published.observed_revision, &snapshot);
  if (captured.status != OperationStatus::committed ||
      !snapshot.missing_keys.empty() || snapshot.formats.size() != 1) {
    return false;
  }
  const auto& actual = snapshot.formats.front();
  return actual.key == expected.key && actual.native_name == expected.native_name &&
         actual.format_id == expected.format_id &&
         actual.bytes == expected.bytes && actual.encoding == expected.encoding &&
         actual.fidelity == expected.fidelity &&
         actual.source_format == expected.source_format &&
         actual.source_origin == expected.source_origin &&
         actual.materialization == expected.materialization;
}

}  // namespace

std::vector<CaseResult> RunUrlFormatCases(Win32ClipboardAdapter* adapter) {
  if (adapter == nullptr || adapter->Window() == nullptr) {
    return AllNotRun("private-station clipboard adapter is unavailable");
  }
  const UINT ansi_lower_id = RegisterClipboardFormatW(L"uniformresourcelocator");
  const UINT wide_mixed_id =
      RegisterClipboardFormatW(L"uNiFoRmReSoUrCeLoCaToRw");
  const UINT ansi_id = RegisterClipboardFormatW(CFSTR_INETURLA);
  const UINT wide_id = RegisterClipboardFormatW(CFSTR_INETURLW);
  if (ansi_lower_id == 0 || wide_mixed_id == 0 || ansi_id == 0 || wide_id == 0) {
    return AllNotRun("Shell URL clipboard format registration failed");
  }

  std::vector<CaseResult> results;
  results.reserve(7);
  const bool format_names_match =
      ansi_lower_id == ansi_id && wide_mixed_id == wide_id &&
      EqualAsciiInsensitive(StableFormatName(ansi_id),
                            "UniformResourceLocator") &&
      EqualAsciiInsensitive(StableFormatName(wide_id),
                            "UniformResourceLocatorW") &&
      DescribeUrlFormat(ansi_id).has_value() &&
      DescribeUrlFormat(wide_id).has_value();
  Add(&results, kCaseFormatNames, format_names_match ? "pass" : "fail",
      format_names_match
          ? "registered names map to the ANSI and Unicode Shell URL formats"
          : "registered format IDs did not resolve to the documented names");

  const FormatPayload wide = MakeWidePayload(
      wide_id, u"https://例子.invalid/路径?q=%E9%9B%AA");
  const bool wide_valid = IsPayloadWellFormed(wide, nullptr);
  const bool wide_round_trip = wide_valid && RoundTrip(adapter, wide);
  Add(&results, kCaseWideRoundTrip,
      wide_round_trip ? "pass" : "fail",
      wide_round_trip
          ? "raw Unicode and percent escapes survived private clipboard replay byte-for-byte"
          : wide_valid ? "private clipboard round-trip did not preserve the URL bytes"
                       : "Unicode Shell URL fixture failed payload validation");

  FormatPayload ansi;
  const bool ansi_sample = MakeNonAsciiAnsiSample(ansi_id, GetACP(), &ansi);
  if (!ansi_sample) {
    Add(&results, kCaseAnsiRoundTrip, "not-run",
        "the active ACP did not encode any configured non-ASCII URL fixture");
  } else {
    const bool ansi_valid = IsPayloadWellFormed(ansi, nullptr);
    const bool ansi_round_trip = ansi_valid && RoundTrip(adapter, ansi);
    Add(&results, kCaseAnsiRoundTrip,
        ansi_round_trip ? "pass" : "fail",
        ansi_round_trip
            ? "current-ACP non-ASCII bytes survived private clipboard replay unchanged"
            : ansi_valid ? "private clipboard round-trip did not preserve ACP bytes"
                         : "ANSI URL fixture failed strict current-ACP validation");
  }

  std::string acp_validation_detail;
  bool acp_validation_not_run = false;
  const bool acp_validation_passed =
      RunAcpValidation(ansi_id, GetACP(), &acp_validation_not_run,
                       &acp_validation_detail);
  Add(&results, kCaseAcpValidation,
      acp_validation_not_run ? "not-run"
                             : acp_validation_passed ? "pass" : "fail",
      std::move(acp_validation_detail));

  std::vector<std::uint8_t> ascii_bytes;
  const bool ascii_encoded =
      EncodeAcp(u"https://example.invalid/acp", GetACP(), &ascii_bytes);
  FormatPayload stale = MakeAnsiPayload(ansi_id,
      GetACP() == CP_UTF8 ? 1252 : CP_UTF8, std::move(ascii_bytes));
  const bool acp_change_rejected =
      ascii_encoded && !IsNativePayloadWellFormed(stale) &&
      !NativeLogicalLength(stale).has_value();
  Add(&results, kCaseAcpMismatch, acp_change_rejected ? "pass" : "fail",
      acp_change_rejected
          ? "payload tagged with another ACP was rejected before replay"
          : "payload with stale ANSI code-page identity was accepted");

  bool raw_uri_preserved = true;
  for (const auto value : {
      u"ftp://user:secret@例子.invalid/路径?q=%e9%9b%aa#fragment",
      u"file:///C:/synthetic/%E9%9B%AA.txt", u"myapp:",
      u"custom+scheme://host:65536/a?x=1#fragment", u"mailto:?subject=fixture",
      u"data:text/plain;base64,c3ludGhldGlj", u"javascript:alert(1)",
      u"https://example.invalid/cafe\u0301?raw=%2f#%41"}) {
    const auto raw = MakeWidePayload(wide_id, value);
    const bool one_preserved = IsPayloadWellFormed(raw, nullptr) && RoundTrip(adapter, raw);
    raw_uri_preserved = one_preserved && raw_uri_preserved;
  }
  Add(&results, kCaseRawUri, raw_uri_preserved ? "pass" : "fail",
      raw_uri_preserved ? "absolute URI bytes survived storage without opening any scheme"
                        : "raw absolute URI storage changed or rejected valid bytes");

  FormatPayload wrong_id = wide;
  wrong_id.format_id = ansi_id;
  FormatPayload wrong_key = wide;
  wrong_key.key = "url-ansi";
  FormatPayload wrong_name = wide;
  wrong_name.native_name = L"UniformResourceLocator";
  FormatPayload wrong_encoding = wide;
  wrong_encoding.encoding = "utf8";
  FormatPayload wrong_source = wide;
  wrong_source.source_format = "UniformResourceLocator";
  FormatPayload wrong_origin = wide;
  wrong_origin.source_origin = "derived";
  FormatPayload wrong_fidelity = wide;
  wrong_fidelity.fidelity = "normalized";
  FormatPayload wrong_materialization = wide;
  wrong_materialization.materialization = "synthesized-url";
  const bool id_rejected =
      !IsNativePayloadWellFormed(wrong_id) &&
      !IsNativePayloadWellFormed(wrong_key) &&
      !IsNativePayloadWellFormed(wrong_name) &&
      !IsNativePayloadWellFormed(wrong_encoding) &&
      !IsNativePayloadWellFormed(wrong_source) &&
      !IsNativePayloadWellFormed(wrong_origin) &&
      !IsNativePayloadWellFormed(wrong_fidelity) &&
      !IsNativePayloadWellFormed(wrong_materialization);
  Add(&results, kCaseIdMismatch, id_rejected ? "pass" : "fail",
      id_rejected
          ? "format-ID, key, name, encoding, source, origin, fidelity, and materialization mutations were rejected"
          : "a mismatched URL payload identity mutation was accepted");
  return results;
}

}  // namespace clipboard_format_probe
