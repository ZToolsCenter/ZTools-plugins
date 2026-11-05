#include "clipboard_format_receipts.h"

#include "clipboard_format_equivalence.h"
#include "clipboard_formats.h"
#include "clipboard_url_formats.h"

#include <windows.h>

#include <algorithm>
#include <array>
#include <charconv>
#include <initializer_list>
#include <string_view>
#include <utility>

namespace clipboard_format_probe {
namespace {

constexpr std::size_t kReceiptByteLimit = 20 * 1024 * 1024;
constexpr std::size_t kReceiptFormatLimit = 32;
struct FormatSpec {
  std::string_view key;
  std::string_view native_name;
  std::string_view codec;
  std::string_view encoding;
  std::string_view fidelity;
  std::string_view materialization;
};

constexpr std::array<FormatSpec, 16> kFormatSpecs{{
    {"text", "CF_UNICODETEXT", "unicode-text", "utf16le-null-terminated",
     "representation-bytes-preserved", "current-clipboard-format-bytes"},
    {"html", "HTML Format", "cf-html", "cf-html-offset-format",
     "representation-bytes-preserved", "current-clipboard-format-bytes"},
    {"rtf", "Rich Text Format", "rtf", "rtf-bytes",
     "representation-bytes-preserved", "current-clipboard-format-bytes"},
    {"png", "PNG", "png", "png-bytes",
     "representation-bytes-preserved", "current-clipboard-format-bytes"},
    {"image-png", "image/png", "png", "png-bytes",
     "representation-bytes-preserved", "current-clipboard-format-bytes"},
    {"tiff", "CF_TIFF", "classic-tiff", "tiff6-bytes",
     "representation-bytes-preserved", "current-clipboard-format-bytes"},
    {"dib", "CF_DIB", "dib", "windows-dib",
     "representation-bytes-preserved", "current-clipboard-format-bytes"},
    {"dibv5", "CF_DIBV5", "dibv5", "windows-dibv5",
     "representation-bytes-preserved", "current-clipboard-format-bytes"},
    {"bitmap", "CF_BITMAP", "bitmap-rgb24", "dib24-rendered",
     "visible-rgb-compatible", "win32-getdibits-24bpp-top-down"},
    {"palette", "CF_PALETTE", "logpalette", "logpalette-v0300",
     "palette-entries-preserved", "win32-getpaletteentries-logpalette-v0300"},
    {"file-list", "CF_HDROP", "hdrop", "", "representation-bytes-preserved",
     "current-clipboard-format-bytes"},
    {"text-acp", "CF_TEXT", "ansi-text", "windows-acp-raw",
     "representation-bytes-preserved", "current-clipboard-format-bytes"},
    {"text-oem", "CF_OEMTEXT", "oem-text", "windows-oemcp-raw",
     "representation-bytes-preserved", "current-clipboard-format-bytes"},
    {"locale", "CF_LOCALE", "locale-lcid", "windows-lcid-le",
     "representation-bytes-preserved", "current-clipboard-format-bytes"},
    {"url-ansi", "UniformResourceLocator", "url-ansi", "windows-acp-url",
     "representation-bytes-preserved", "current-clipboard-format-bytes"},
    {"url-wide", "UniformResourceLocatorW", "url-wide",
     "utf16le-url-null-terminated", "representation-bytes-preserved",
     "current-clipboard-format-bytes"},
}};

constexpr std::array<std::string_view, 7> kCaseIds{{
    "receipt-rich-formats", "receipt-tiff", "receipt-native-images",
    "receipt-files-wide", "receipt-files-ansi", "receipt-ansi-oem-locale",
    "receipt-url-wide-ansi"}};

const FormatSpec* FindSpec(std::string_view key) noexcept {
  for (const auto& spec : kFormatSpecs) {
    if (spec.key == key) return &spec;
  }
  return nullptr;
}

bool IsKnownCase(std::string_view case_id) noexcept {
  return std::find(kCaseIds.begin(), kCaseIds.end(), case_id) != kCaseIds.end();
}

bool WideEqualsAscii(std::wstring_view value, std::string_view ascii) noexcept {
  if (value.size() != ascii.size()) return false;
  for (std::size_t i = 0; i < value.size(); ++i) {
    if (value[i] != static_cast<wchar_t>(static_cast<unsigned char>(ascii[i]))) {
      return false;
    }
  }
  return true;
}

bool IsValidCodePageValue(UINT code_page) noexcept {
  return code_page > 0 && code_page <= 65535;
}

bool ParseUrlCodePage(std::string_view encoding, UINT* code_page) {
  constexpr std::string_view prefix = "windows-acp-url-";
  if (code_page == nullptr || encoding.size() <= prefix.size() ||
      encoding.substr(0, prefix.size()) != prefix) {
    return false;
  }
  const auto digits = encoding.substr(prefix.size());
  UINT parsed = 0;
  const auto result =
      std::from_chars(digits.data(), digits.data() + digits.size(), parsed);
  if (result.ec != std::errc{} || result.ptr != digits.data() + digits.size() ||
      !IsValidCodePageValue(parsed) || std::to_string(parsed) != digits) {
    return false;
  }
  *code_page = parsed;
  return true;
}

bool IsRegisteredName(UINT format_id, std::string_view expected) {
  return format_id >= 0xC000 && format_id <= 0xFFFF &&
         RegisteredFormatNamesEqual(StableFormatName(format_id), expected);
}

bool HasExpectedFormatId(const FormatPayload& payload) {
  if (payload.key == "text") return payload.format_id == CF_UNICODETEXT;
  if (payload.key == "tiff") return payload.format_id == CF_TIFF;
  if (payload.key == "dib") return payload.format_id == CF_DIB;
  if (payload.key == "dibv5") return payload.format_id == CF_DIBV5;
  if (payload.key == "bitmap") return payload.format_id == CF_BITMAP;
  if (payload.key == "palette") return payload.format_id == CF_PALETTE;
  if (payload.key == "file-list") return payload.format_id == CF_HDROP;
  if (payload.key == "text-acp") return payload.format_id == CF_TEXT;
  if (payload.key == "text-oem") return payload.format_id == CF_OEMTEXT;
  if (payload.key == "locale") return payload.format_id == CF_LOCALE;
  const auto* spec = FindSpec(payload.key);
  return spec != nullptr && IsRegisteredName(payload.format_id, spec->native_name);
}

bool PayloadMetadataMatches(const FormatPayload& payload, UINT helper_acp,
                            WindowsFormatEvidence* evidence) {
  if (evidence == nullptr) return false;
  const auto* spec = FindSpec(payload.key);
  if (spec == nullptr || !HasExpectedFormatId(payload) ||
      !WideEqualsAscii(payload.native_name, spec->native_name) ||
      payload.source_format != spec->native_name ||
      payload.source_origin != "unknown" || payload.fidelity != spec->fidelity ||
      payload.materialization != spec->materialization) {
    return false;
  }

  evidence->key.assign(spec->key);
  evidence->native_name.assign(spec->native_name);
  evidence->codec.assign(spec->codec);
  evidence->fidelity.assign(spec->fidelity);
  evidence->materialization.assign(spec->materialization);
  if (payload.key == "file-list") {
    if (payload.encoding == "utf16le-dropfiles") {
      if (payload.validation_code_page.has_value()) return false;
      evidence->encoding = payload.encoding;
      evidence->validation_code_page.reset();
    } else if (payload.encoding == "ansi-dropfiles" &&
               payload.validation_code_page == helper_acp) {
      evidence->encoding = payload.encoding;
      evidence->validation_code_page = helper_acp;
    } else {
      return false;
    }
    evidence->url_code_page.reset();
  } else if (payload.key == "url-ansi") {
    UINT payload_code_page = 0;
    if (payload.validation_code_page.has_value() ||
        !ParseUrlCodePage(payload.encoding, &payload_code_page) ||
        payload_code_page != helper_acp) {
      return false;
    }
    evidence->encoding.assign(spec->encoding);
    evidence->url_code_page = payload_code_page;
    evidence->validation_code_page.reset();
  } else {
    if (payload.validation_code_page.has_value() ||
        payload.encoding != spec->encoding) {
      return false;
    }
    evidence->encoding.assign(spec->encoding);
    evidence->validation_code_page.reset();
    evidence->url_code_page.reset();
  }
  return true;
}

bool SameKeys(const std::vector<std::string>& keys,
              const std::vector<FormatPayload>& formats) {
  if (keys.size() != formats.size()) return false;
  for (std::size_t i = 0; i < keys.size(); ++i) {
    if (keys[i].empty()) return false;
    for (std::size_t j = i + 1; j < keys.size(); ++j) {
      if (keys[i] == keys[j]) return false;
    }
    if (std::none_of(formats.begin(), formats.end(), [&](const auto& format) {
          return format.key == keys[i];
        })) {
      return false;
    }
  }
  return true;
}

bool UniqueFormatKeys(const std::vector<FormatPayload>& formats) {
  for (std::size_t i = 0; i < formats.size(); ++i) {
    if (formats[i].key.empty()) return false;
    for (std::size_t j = i + 1; j < formats.size(); ++j) {
      if (formats[i].key == formats[j].key) return false;
    }
  }
  return true;
}

const FormatPayload* FindFormat(const std::vector<FormatPayload>& formats,
                                std::string_view key) noexcept {
  const auto found = std::find_if(formats.begin(), formats.end(),
                                  [&](const auto& format) {
                                    return format.key == key;
                                  });
  return found == formats.end() ? nullptr : &*found;
}

const WindowsFormatEvidence* FindEvidence(const WindowsRoundTripReceipt& receipt,
                                          std::string_view key) noexcept;
bool OperationCommitted(const OperationResult& operation) noexcept {
  return operation.status == OperationStatus::committed &&
         operation.missing_keys.empty();
}

bool HasKeys(const WindowsRoundTripReceipt& receipt,
             std::initializer_list<std::string_view> keys) noexcept {
  for (const auto key : keys) {
    if (std::none_of(receipt.formats.begin(), receipt.formats.end(),
                     [&](const auto& format) { return format.key == key; })) {
      return false;
    }
  }
  return true;
}

bool HasCaseCoverage(const WindowsRoundTripReceipt& receipt) noexcept {
  if (receipt.case_id == "receipt-rich-formats") {
    return HasKeys(receipt, {"text", "html", "rtf", "png", "image-png"});
  }
  if (receipt.case_id == "receipt-tiff") return HasKeys(receipt, {"tiff"});
  if (receipt.case_id == "receipt-native-images") {
    return HasKeys(receipt, {"dib", "dibv5", "bitmap", "palette"});
  }
  if (receipt.case_id == "receipt-files-wide") {
    return HasKeys(receipt, {"file-list"}) &&
           FindEvidence(receipt, "file-list")->encoding == "utf16le-dropfiles";
  }
  if (receipt.case_id == "receipt-files-ansi") {
    const auto* file_list = FindEvidence(receipt, "file-list");
    return file_list != nullptr && file_list->encoding == "ansi-dropfiles" &&
           file_list->validation_code_page == receipt.helper_code_page;
  }
  if (receipt.case_id == "receipt-ansi-oem-locale") {
    return HasKeys(receipt, {"text-acp", "text-oem", "locale"});
  }
  if (receipt.case_id == "receipt-url-wide-ansi") {
    return HasKeys(receipt, {"url-ansi", "url-wide"});
  }
  return false;
}

const WindowsFormatEvidence* FindEvidence(const WindowsRoundTripReceipt& receipt,
                                          std::string_view key) noexcept {
  const auto found = std::find_if(receipt.formats.begin(), receipt.formats.end(),
                                  [&](const auto& format) {
                                    return format.key == key;
                                  });
  return found == receipt.formats.end() ? nullptr : &*found;
}

bool IsLowerSha256(std::string_view value) noexcept {
  if (value.size() != 64) return false;
  for (const char character : value) {
    if (!((character >= '0' && character <= '9') ||
          (character >= 'a' && character <= 'f'))) {
      return false;
    }
  }
  return true;
}

bool ValidSummary(const ReceiptByteSummary& summary) noexcept {
  return summary.byte_length <= kReceiptByteLimit &&
         IsLowerSha256(summary.sha256);
}

bool ValidEvidence(const WindowsFormatEvidence& evidence, UINT helper_acp) noexcept {
  const auto* spec = FindSpec(evidence.key);
  if (spec == nullptr || evidence.native_name != spec->native_name ||
      evidence.codec != spec->codec || evidence.fidelity != spec->fidelity ||
      evidence.materialization != spec->materialization ||
      !ValidSummary(evidence.planned) || !ValidSummary(evidence.readback)) {
    return false;
  }
  if (evidence.key == "file-list") {
    if (evidence.url_code_page.has_value()) return false;
    if (evidence.encoding == "utf16le-dropfiles") {
      if (evidence.validation_code_page.has_value()) return false;
    } else if (evidence.encoding == "ansi-dropfiles") {
      if (evidence.validation_code_page != helper_acp) return false;
    } else {
      return false;
    }
  } else if (evidence.key == "url-ansi") {
    if (evidence.encoding != spec->encoding ||
        evidence.validation_code_page.has_value() ||
        evidence.url_code_page != helper_acp) {
      return false;
    }
  } else if (evidence.encoding != spec->encoding ||
             evidence.validation_code_page.has_value() ||
             evidence.url_code_page.has_value()) {
    return false;
  }
  if (evidence.comparison == "exact") {
    return evidence.planned.byte_length == evidence.readback.byte_length &&
           evidence.planned.sha256 == evidence.readback.sha256;
  }
  return evidence.comparison == "visible-rgb-compatible" &&
         evidence.key == "bitmap" &&
         (evidence.planned.byte_length != evidence.readback.byte_length ||
          evidence.planned.sha256 != evidence.readback.sha256);
}

}  // namespace

bool BuildWindowsRoundTripReceipt(
    const std::string& case_id, const ClipboardSnapshot& source,
    const OperationResult& source_result,
    const OperationResult& published, const ClipboardSnapshot& readback,
    const OperationResult& readback_result, WindowsRoundTripReceipt* output) {
  if (output == nullptr) return false;
  output->case_id.clear();
  output->source_revision = 0;
  output->expected_revision = 0;
  output->write_revision = 0;
  output->readback_revision = 0;
  output->observed_revision = 0;
  output->helper_code_page = 0;
  output->helper_oem_code_page = 0;
  output->formats.clear();

  try {
    const std::uint32_t source_revision = source.revision_before_open;
    const UINT helper_acp = GetACP();
    const UINT helper_oemcp = GetOEMCP();
    if (!IsKnownCase(case_id) || !OperationCommitted(source_result) ||
        !OperationCommitted(published) || !OperationCommitted(readback_result) ||
        !source.capture_policy.capture_allowed ||
        !readback.capture_policy.capture_allowed ||
        source.formats.empty() || source.formats.size() > kReceiptFormatLimit ||
        readback.formats.empty() ||
        readback.formats.size() > kReceiptFormatLimit ||
        !source.missing_keys.empty() || !readback.missing_keys.empty() ||
        source_revision == 0 || source.revision_after_materialization != source_revision ||
        source_result.expected_revision != source_revision ||
        source_result.observed_revision != source_revision ||
        !published.write_revision.has_value() || *published.write_revision == 0 ||
        published.expected_revision != source_revision ||
        published.observed_revision != *published.write_revision ||
        readback.revision_before_open != *published.write_revision ||
        readback.revision_after_materialization != *published.write_revision ||
        readback_result.expected_revision != *published.write_revision ||
        readback_result.observed_revision != *published.write_revision ||
        !IsValidCodePageValue(helper_acp) || !IsValidCodePageValue(helper_oemcp) ||
        !UniqueFormatKeys(source.formats) || !UniqueFormatKeys(readback.formats) ||
        !SameKeys(source_result.planned_keys, source.formats) ||
        !SameKeys(readback_result.planned_keys, readback.formats) ||
        !SameKeys(published.planned_keys, source.formats) ||
        !SameKeys(published.written_keys, source.formats)) {
      return false;
    }

    std::size_t source_bytes = 0;
    std::size_t readback_bytes = 0;
    for (const auto& format : source.formats) {
      if (format.bytes.empty() || format.bytes.size() > kReceiptByteLimit - source_bytes) {
        return false;
      }
      source_bytes += format.bytes.size();
    }
    for (const auto& format : readback.formats) {
      if (format.bytes.empty() ||
          format.bytes.size() > kReceiptByteLimit - readback_bytes) {
        return false;
      }
      readback_bytes += format.bytes.size();
    }
    if (source.formats.size() != readback.formats.size()) return false;

    WindowsRoundTripReceipt receipt;
    receipt.case_id = case_id;
    receipt.source_revision = source_revision;
    receipt.expected_revision = published.expected_revision;
    receipt.write_revision = *published.write_revision;
    receipt.readback_revision = readback.revision_after_materialization;
    receipt.observed_revision = readback_result.observed_revision;
    receipt.helper_code_page = helper_acp;
    receipt.helper_oem_code_page = helper_oemcp;
    receipt.formats.reserve(source.formats.size());

    for (const auto& expected : source.formats) {
      const auto* actual = FindFormat(readback.formats, expected.key);
      if (actual == nullptr) return false;
      WindowsFormatEvidence evidence;
      if (!PayloadMetadataMatches(expected, helper_acp, &evidence)) return false;
      WindowsFormatEvidence actual_evidence;
      if (!PayloadMetadataMatches(*actual, helper_acp, &actual_evidence) ||
          evidence.key != actual_evidence.key ||
          evidence.native_name != actual_evidence.native_name ||
          evidence.codec != actual_evidence.codec ||
          evidence.encoding != actual_evidence.encoding ||
          evidence.fidelity != actual_evidence.fidelity ||
          evidence.materialization != actual_evidence.materialization ||
          evidence.validation_code_page != actual_evidence.validation_code_page ||
          evidence.url_code_page != actual_evidence.url_code_page) {
        return false;
      }

      const auto comparison = CompareFormatRepresentations(
          expected, *actual, FormatComparisonMode::allow_visible_bitmap_rgb);
      if (comparison == FormatComparison::exact) {
        evidence.comparison = "exact";
      } else if (comparison == FormatComparison::compatible &&
                 expected.key == "bitmap") {
        evidence.comparison = "visible-rgb-compatible";
      } else {
        return false;
      }
      evidence.planned.byte_length = expected.bytes.size();
      evidence.readback.byte_length = actual->bytes.size();
      if (!HashWindowsReceiptBytes(expected.bytes.data(), expected.bytes.size(),
                                   &evidence.planned.sha256) ||
          !HashWindowsReceiptBytes(actual->bytes.data(), actual->bytes.size(),
                                   &evidence.readback.sha256)) {
        return false;
      }
      receipt.formats.push_back(std::move(evidence));
    }

    if (!receipt_detail::IsWindowsRoundTripReceiptValid(receipt, true)) {
      return false;
    }
    *output = std::move(receipt);
    return true;
  } catch (...) {
    output->case_id.clear();
    output->formats.clear();
    return false;
  }
}

namespace receipt_detail {

bool IsWindowsRoundTripReceiptValid(const WindowsRoundTripReceipt& receipt,
                                    bool require_case_coverage) {
  if (!IsKnownCase(receipt.case_id) || receipt.formats.empty() ||
      receipt.formats.size() > kReceiptFormatLimit ||
      receipt.source_revision == 0 ||
      receipt.expected_revision != receipt.source_revision ||
      receipt.write_revision == 0 ||
      receipt.readback_revision != receipt.write_revision ||
      receipt.observed_revision != receipt.write_revision ||
      !IsValidCodePageValue(receipt.helper_code_page) ||
      !IsValidCodePageValue(receipt.helper_oem_code_page)) {
    return false;
  }
  std::uint64_t planned_total = 0;
  std::uint64_t readback_total = 0;
  for (std::size_t i = 0; i < receipt.formats.size(); ++i) {
    const auto& evidence = receipt.formats[i];
    if (!ValidEvidence(evidence, receipt.helper_code_page) ||
        evidence.planned.byte_length > kReceiptByteLimit - planned_total ||
        evidence.readback.byte_length > kReceiptByteLimit - readback_total) {
      return false;
    }
    planned_total += evidence.planned.byte_length;
    readback_total += evidence.readback.byte_length;
    for (std::size_t j = i + 1; j < receipt.formats.size(); ++j) {
      if (evidence.key == receipt.formats[j].key) return false;
    }
  }
  return !require_case_coverage || HasCaseCoverage(receipt);
}

}  // namespace receipt_detail

}  // namespace clipboard_format_probe
