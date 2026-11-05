#include "clipboard_format_receipt_tests.h"

#include "clipboard_format_receipts.h"
#include "clipboard_formats.h"
#include "clipboard_file_reference_fixture.h"
#include "clipboard_self_test_comparison.h"
#include "clipboard_self_test_fixtures.h"
#include "clipboard_tiff_fixture.h"
#include "clipboard_url_formats.h"
#include "../common/clipboard_codecs.h"

#include <array>
#include <functional>
#include <limits>
#include <string>
#include <utility>
#include <vector>

namespace clipboard_format_probe {
namespace {
constexpr std::array<const char*, 9> kCaseIds = {
    "receipt-rich-formats", "receipt-tiff", "receipt-native-images",
    "receipt-files-wide", "receipt-ansi-oem-locale", "receipt-url-wide-ansi",
    "receipt-files-ansi",
    "receipt-sha256-known-answers", "receipt-invalid-binding-rejected"};

struct RoundTripTrial {
  ClipboardSnapshot source;
  OperationResult source_result;
  OperationResult published;
  ClipboardSnapshot readback;
  OperationResult readback_result;
  WindowsRoundTripReceipt receipt;
};

void Add(ProbeReport* report, const char* id, const char* status) {
  report->cases.push_back(CaseResult{id, status, "case-result"});
}

bool Collect(Win32ClipboardAdapter* adapter, const char* case_id,
             const std::vector<FormatPayload>& seed, RoundTripTrial* trial) {
  if (adapter == nullptr || trial == nullptr || seed.empty()) return false;
  *trial = RoundTripTrial{};
  const auto seeded = adapter->Publish(adapter->Revision(), seed);
  if (!self_test_comparison::PublishWroteExactly(seeded, seed) ||
      !seeded.write_revision) return false;
  trial->source_result = adapter->Capture(*seeded.write_revision, &trial->source);
  if (!self_test_comparison::CompleteCaptureMatchesPublished(
          seed, trial->source_result, trial->source, true)) return false;

  // Freeze the complete actual format set, including supported OS synthesis.
  // The captured revision, not a later observation, gates the replay.
  trial->published = adapter->Publish(
      trial->source.revision_after_materialization, trial->source.formats);
  if (!self_test_comparison::PublishWroteExactly(
          trial->published, trial->source.formats) ||
      !trial->published.write_revision) return false;
  trial->readback_result = adapter->Capture(*trial->published.write_revision,
                                           &trial->readback);
  if (!self_test_comparison::CompleteCaptureMatchesExactly(
          trial->source.formats, trial->readback_result, trial->readback, true)) {
    return false;
  }
  // Build/hash only owned snapshots after Capture/Publish have closed sessions.
  return BuildWindowsRoundTripReceipt(case_id, trial->source,
      trial->source_result, trial->published, trial->readback,
      trial->readback_result, &trial->receipt);
}

FormatPayload NativeBytes(UINT id, std::vector<std::uint8_t> bytes) {
  auto payload = DescribeNativeFormat(id);
  if (!payload) return {};
  payload->bytes = std::move(bytes);
  return std::move(*payload);
}

std::vector<FormatPayload> RichFixtures() {
  const UINT html = RegisterClipboardFormatW(L"HTML Format");
  const UINT rtf = RegisterClipboardFormatW(L"Rich Text Format");
  const UINT png = RegisterClipboardFormatW(L"PNG");
  const UINT image_png = RegisterClipboardFormatW(L"image/png");
  if (html == 0 || rtf == 0 || png == 0 || image_png == 0) return {};
  auto image = DescribeOsClipboardBytes("image-png", L"image/png", image_png,
                                       "png-bytes", "image/png");
  image.bytes = test_fixtures::MakePng(png).bytes;
  return {test_fixtures::MakeText(CF_UNICODETEXT),
          test_fixtures::MakeHtml(html), test_fixtures::MakeRtf(rtf),
          test_fixtures::MakePng(png), std::move(image)};
}

std::vector<FormatPayload> UrlFixtures() {
  const UINT ansi_id = RegisterClipboardFormatW(L"UniformResourceLocator");
  const UINT wide_id = RegisterClipboardFormatW(L"UniformResourceLocatorW");
  auto ansi = DescribeUrlFormat(ansi_id);
  auto wide = DescribeUrlFormat(wide_id);
  if (!ansi || !wide) return {};
  const std::string url = "https://example.invalid/receipt%20fixture?q=1";
  ansi->bytes.assign(url.begin(), url.end());
  ansi->bytes.push_back(0);
  for (const unsigned char value : url) {
    wide->bytes.push_back(value);
    wide->bytes.push_back(0);
  }
  wide->bytes.push_back(0);
  wide->bytes.push_back(0);
  return {std::move(*ansi), std::move(*wide)};
}

bool EncodeFixturePathAsAcp(const std::wstring& path, std::string* output) {
  if (output == nullptr || path.empty() || path.size() > 32768) return false;
  output->clear();
  const UINT cp = GetACP();
  const bool flagless = cp == 42 || cp == 65000 || cp == 50220 || cp == 50221 ||
      cp == 50222 || cp == 50225 || cp == 50227 || cp == 50229 ||
      (cp >= 57002 && cp <= 57011);
  const DWORD flags = cp == CP_UTF8 || cp == 54936 ? WC_ERR_INVALID_CHARS
      : flagless ? 0 : WC_NO_BEST_FIT_CHARS;
  BOOL substituted = FALSE;
  BOOL* used_default = cp == CP_UTF8 || cp == 54936 || cp == 65000
      ? nullptr : &substituted;
  const int required = WideCharToMultiByte(cp, flags, path.data(),
      static_cast<int>(path.size()), nullptr, 0, nullptr, used_default);
  if (required <= 0 || substituted) return false;
  std::string encoded(static_cast<std::size_t>(required), '\0');
  substituted = FALSE;
  if (WideCharToMultiByte(cp, flags, path.data(), static_cast<int>(path.size()),
      encoded.data(), required, nullptr, used_default) != required || substituted) {
    return false;
  }
  const int units = MultiByteToWideChar(cp, 0, encoded.data(), required, nullptr, 0);
  if (units <= 0) return false;
  std::wstring decoded(static_cast<std::size_t>(units), L'\0');
  if (MultiByteToWideChar(cp, 0, encoded.data(), required, decoded.data(), units) != units ||
      decoded != path) return false;
  *output = std::move(encoded);
  return true;
}

bool BuildAnsiDropFixture(const std::vector<std::string>& paths,
                           std::vector<std::uint8_t>* bytes) {
  if (bytes == nullptr || paths.empty()) return false;
  bytes->assign(20, 0);
  (*bytes)[0] = 20;  // DROPFILES.pFiles; fWide remains FALSE.
  for (const auto& path : paths) {
    if (path.empty() || path.find('\0') != std::string::npos ||
        path.size() + 2 > clipboard_codecs::kMaximumDropFilesBytes - bytes->size()) {
      bytes->clear();
      return false;
    }
    bytes->insert(bytes->end(), path.begin(), path.end());
    bytes->push_back(0);
  }
  bytes->push_back(0);
  clipboard_codecs::DropFilesLayout layout;
  return clipboard_codecs::AnalyzeDropFiles(bytes->data(), bytes->size(), &layout) &&
      !layout.wide && layout.file_count == paths.size() &&
      layout.logical_bytes == bytes->size();
}

bool HashKnownAnswers() {
  std::string digest = "old-value";
  if (!HashWindowsReceiptBytes(nullptr, 0, &digest) ||
      digest != "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855") {
    return false;
  }
  constexpr std::array<std::uint8_t, 3> abc = {'a', 'b', 'c'};
  if (!HashWindowsReceiptBytes(abc.data(), abc.size(), &digest) ||
      digest != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") {
    return false;
  }
  if (HashWindowsReceiptBytes(nullptr, 1, &digest) || !digest.empty()) return false;
  digest = "old-value";
  return !HashWindowsReceiptBytes(abc.data(), 20 * 1024 * 1024 + 1, &digest) &&
      digest.empty() && !HashWindowsReceiptBytes(abc.data(), abc.size(), nullptr);
}

bool InvalidBindingsRejected(const RoundTripTrial& valid) {
  const auto rejected = [&valid](const std::function<void(RoundTripTrial&)>& change) {
    RoundTripTrial invalid = valid;
    change(invalid);
    WindowsRoundTripReceipt output = valid.receipt;
    return !BuildWindowsRoundTripReceipt(valid.receipt.case_id,
        invalid.source, invalid.source_result, invalid.published,
        invalid.readback, invalid.readback_result, &output) &&
        output.formats.empty() && output.case_id.empty();
  };
  if (!rejected([](auto& item) {
        item.source_result.status = OperationStatus::partial_capture;
      }) ||
      !rejected([](auto& item) {
        item.source_result.observed_revision ^= 1U;
      }) ||
      !rejected([](auto& item) { item.source_result.planned_keys.pop_back(); }) ||
      !rejected([](auto& item) { item.readback_result.planned_keys.pop_back(); }) ||
      !rejected([](auto& item) {
        item.source.revision_after_materialization ^= 1U;
      }) ||
      !rejected([](auto& item) { item.published.write_revision.reset(); }) ||
      !rejected([](auto& item) { item.published.observed_revision ^= 1U; }) ||
      !rejected([](auto& item) { item.readback_result.observed_revision ^= 1U; }) ||
      !rejected([](auto& item) {
        item.source.capture_policy.capture_allowed = false;
      }) ||
      !rejected([](auto& item) {
        item.source.formats.front().source_origin = "trusted";
      }) ||
      !rejected([](auto& item) {
        item.readback.formats.front().native_name = L"private-identifier";
      }) ||
      !rejected([](auto& item) {
        item.readback.formats.push_back(item.readback.formats.front());
      }) ||
      !rejected([](auto& item) {
        item.readback.formats.front().bytes.front() ^= 1U;
      })) return false;

  WindowsRoundTripReceipt output = valid.receipt;
  if (BuildWindowsRoundTripReceipt("private-case-identifier", valid.source,
      valid.source_result, valid.published, valid.readback,
      valid.readback_result, &output) || !output.formats.empty()) return false;
  auto invalid = valid.receipt;
  invalid.formats.front().codec = "private-codec-text";
  return SerializeWindowsFormatReceipts({invalid}) == "[]" &&
      !WindowsFormatReceiptsComplete({invalid});
}
}  // namespace

void RunWindowsFormatReceiptCases(ProbeReport* report,
                                  Win32ClipboardAdapter* adapter) {
  if (report == nullptr) return;
  if (adapter == nullptr) {
    for (const char* id : kCaseIds) Add(report, id, "not-run");
    return;
  }
  std::array<const char*, 9> statuses;
  statuses.fill("fail");
  RoundTripTrial first;
  try {
    const auto record = [&](std::size_t index,
                            const std::vector<FormatPayload>& seed,
                            RoundTripTrial* retained = nullptr) {
      RoundTripTrial current;
      const bool passed = Collect(adapter, kCaseIds[index], seed, &current);
      if (passed) {
        report->windows_format_receipts.push_back(current.receipt);
        if (retained != nullptr) *retained = std::move(current);
      }
      statuses[index] = passed ? "pass" : "fail";
    };
    record(0, RichFixtures(), &first);
    record(1, {tiff_fixtures::MakeMultipageTiff(CF_TIFF)});
    record(2, {test_fixtures::MakeDib(CF_DIB, false),
               test_fixtures::MakeDib(CF_DIBV5, true),
               test_fixtures::MakeBitmap(CF_BITMAP), test_fixtures::MakePalette()});

    ClipboardFileReferenceFixture files;
    std::vector<std::uint8_t> drop;
    if (files.Create() && clipboard_codecs::BuildDropFilesWide(
        {std::u16string(files.File().begin(), files.File().end()),
         std::u16string(files.Directory().begin(), files.Directory().end())}, &drop)) {
      auto payload = NativeBytes(CF_HDROP, std::move(drop));
      payload.encoding = "utf16le-dropfiles";
      record(3, {std::move(payload)});
    } else {
      statuses[3] = "not-run";
    }
    record(4, {NativeBytes(CF_TEXT, {'A', 'C', 'P', 0}),
               NativeBytes(CF_OEMTEXT, {'O', 'E', 'M', 0}),
               NativeBytes(CF_LOCALE, {0x09, 0x04, 0, 0})});
    record(5, UrlFixtures());
    ClipboardFileReferenceFixture ansi_files;
    std::string file_ansi, directory_ansi;
    std::vector<std::uint8_t> ansi_drop;
    if (ansi_files.Create(true) &&
        EncodeFixturePathAsAcp(ansi_files.File(), &file_ansi) &&
        EncodeFixturePathAsAcp(ansi_files.Directory(), &directory_ansi) &&
        BuildAnsiDropFixture({file_ansi, directory_ansi}, &ansi_drop)) {
      auto payload = NativeBytes(CF_HDROP, std::move(ansi_drop));
      payload.encoding = "ansi-dropfiles";
      payload.validation_code_page = GetACP();
      record(6, {std::move(payload)});
    } else {
      // An unrepresentable fixture path is not evidence for ANSI publication.
      statuses[6] = "not-run";
    }
    statuses[7] = HashKnownAnswers() ? "pass" : "fail";
    statuses[8] = first.receipt.formats.empty() ? "not-run"
        : InvalidBindingsRejected(first) ? "pass" : "fail";
  } catch (...) {
    // No OS error message, path, payload or exception text enters the report.
  }
  for (std::size_t index = 0; index < kCaseIds.size(); ++index) {
    Add(report, kCaseIds[index], statuses[index]);
  }
}
}  // namespace clipboard_format_probe
