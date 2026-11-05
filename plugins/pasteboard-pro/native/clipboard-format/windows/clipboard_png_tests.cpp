#include "clipboard_png_tests.h"

#include "clipboard_self_test_fixtures.h"
#include "clipboard_png_wic.h"
#include "../common/clipboard_png.h"

#include <array>
#include <cstdint>
#include <cstring>
#include <functional>
#include <string>
#include <utility>
#include <vector>

namespace clipboard_format_probe {
class ClipboardPngTestAccess final {
 public:
  static void SetValidator(
      Win32ClipboardAdapter* adapter,
      std::function<bool(const std::vector<std::uint8_t>&, std::string*)>
          validator) {
    adapter->png_validator_for_testing_ = std::move(validator);
  }
};

namespace {

constexpr std::array<const char*, 5> kCaseIds = {
    "png-wic-byte-roundtrip",
    "png-wic-16bit-alpha-roundtrip",
    "png-wic-invalid-idat-rejected",
    "png-wic-pixel-budget-rejected",
    "png-wic-capture-validates-after-close",
};

void Add(std::vector<CaseResult>* results, const char* id,
         const char* status, const char* detail) {
  results->push_back(CaseResult{id, status, detail});
}

std::vector<CaseResult> AllNotRun(const char* detail) {
  std::vector<CaseResult> results;
  results.reserve(kCaseIds.size());
  for (const char* id : kCaseIds) Add(&results, id, "not-run", detail);
  return results;
}

bool ReadUserObjectName(HANDLE object, std::wstring* name) {
  DWORD required_bytes = 0;
  SetLastError(ERROR_SUCCESS);
  GetUserObjectInformationW(object, UOI_NAME, nullptr, 0, &required_bytes);
  if (required_bytes < sizeof(wchar_t) || required_bytes > 65536 ||
      GetLastError() != ERROR_INSUFFICIENT_BUFFER) {
    return false;
  }
  std::vector<wchar_t> buffer(
      (required_bytes + sizeof(wchar_t) - 1) / sizeof(wchar_t), L'\0');
  if (!GetUserObjectInformationW(object, UOI_NAME, buffer.data(),
                                 required_bytes, &required_bytes)) {
    return false;
  }
  name->assign(buffer.data());
  return !name->empty();
}

bool IsPrivateProbeStation(const Win32ClipboardAdapter* adapter) {
  const HWINSTA station = GetProcessWindowStation();
  const HDESK desktop = GetThreadDesktop(GetCurrentThreadId());
  if (station == nullptr || desktop == nullptr) return false;
  std::wstring station_name;
  std::wstring desktop_name;
  if (!ReadUserObjectName(station, &station_name) ||
      !ReadUserObjectName(desktop, &desktop_name) ||
      CompareStringOrdinal(station_name.c_str(), -1, L"WinSta0", -1, TRUE) ==
          CSTR_EQUAL ||
      CompareStringOrdinal(desktop_name.c_str(), -1,
                           L"ClipboardFormatProbe", -1, TRUE) != CSTR_EQUAL) {
    return false;
  }
  const DWORD owner_thread =
      GetWindowThreadProcessId(adapter->Window(), nullptr);
  return owner_thread != 0 && GetThreadDesktop(owner_thread) == desktop;
}

FormatPayload Make16BitAlphaPng(UINT format_id) {
  // A 1x1, 16-bit RGBA PNG with distinct channel and alpha values.
  constexpr std::array<std::uint8_t, 74> bytes = {
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x10, 0x06, 0x00, 0x00, 0x00, 0x4f, 0x85, 0x18,
      0xca, 0x00, 0x00, 0x00, 0x11, 0x49, 0x44, 0x41,
      0x54, 0x78, 0xda, 0x63, 0x10, 0x32, 0x09, 0xab,
      0x98, 0xb5, 0xe7, 0xde, 0x07, 0x00, 0x0d, 0xa9,
      0x04, 0x39, 0x2e, 0xef, 0x56, 0xa4, 0x00, 0x00,
      0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
      0x60, 0x82};
  FormatPayload format{"png", L"PNG", format_id,
                       std::vector<std::uint8_t>(bytes.begin(), bytes.end())};
  format.encoding = "png-bytes";
  format.fidelity = "representation-bytes-preserved";
  format.source_format = "PNG";
  format.source_origin = "unknown";
  format.materialization = "current-clipboard-format-bytes";
  return format;
}

bool SamePngCapture(const FormatPayload& expected,
                    const ClipboardSnapshot& snapshot) {
  if (!snapshot.missing_keys.empty() || snapshot.formats.size() != 1) {
    return false;
  }
  const FormatPayload& actual = snapshot.formats.front();
  return actual.key == expected.key &&
         actual.native_name == expected.native_name &&
         actual.format_id == expected.format_id &&
         actual.bytes == expected.bytes &&
         actual.encoding == expected.encoding &&
         actual.fidelity == expected.fidelity &&
         actual.source_format == expected.source_format &&
         actual.source_origin == expected.source_origin &&
         actual.materialization == expected.materialization;
}

bool RoundTripPng(Win32ClipboardAdapter* adapter,
                  const FormatPayload& expected) {
  const OperationResult published =
      adapter->Publish(adapter->Revision(), {expected});
  if (published.status != OperationStatus::committed ||
      published.written_keys != std::vector<std::string>{expected.key} ||
      published.clipboard_may_have_changed == false) {
    return false;
  }
  ClipboardSnapshot snapshot;
  const OperationResult captured =
      adapter->Capture(published.observed_revision, &snapshot);
  return captured.status == OperationStatus::committed &&
         SamePngCapture(expected, snapshot);
}

bool SetRawPngClipboard(Win32ClipboardAdapter* adapter,
                        const FormatPayload& png) {
  if (!OpenClipboard(adapter->Window())) return false;
  bool ready = EmptyClipboard() != FALSE;
  HGLOBAL memory = nullptr;
  if (ready) {
    memory = GlobalAlloc(GMEM_MOVEABLE, png.bytes.size());
    ready = memory != nullptr;
  }
  if (ready) {
    void* target = GlobalLock(memory);
    ready = target != nullptr;
    if (ready) {
      std::memcpy(target, png.bytes.data(), png.bytes.size());
      GlobalUnlock(memory);
      ready = SetClipboardData(png.format_id, memory) != nullptr;
      if (ready) memory = nullptr;
    }
  }
  if (memory != nullptr) GlobalFree(memory);
  const bool closed = CloseClipboard() != FALSE;
  return ready && closed;
}

class PngValidatorReset final {
 public:
  explicit PngValidatorReset(Win32ClipboardAdapter* adapter)
      : adapter_(adapter) {}
  PngValidatorReset(const PngValidatorReset&) = delete;
  PngValidatorReset& operator=(const PngValidatorReset&) = delete;
  ~PngValidatorReset() {
    ClipboardPngTestAccess::SetValidator(adapter_, {});
  }

 private:
  Win32ClipboardAdapter* adapter_;
};

struct PngCaptureValidationEvidence {
  Win32ClipboardAdapter* adapter = nullptr;
  std::uint32_t captured_revision = 0;
  FormatPayload next_clipboard_text;
  std::size_t validator_calls = 0;
  std::size_t wic_calls = 0;
  bool no_open_clipboard_window = false;
  bool clipboard_reopened = false;
  bool clipboard_reclosed = false;
  bool wic_valid = false;
  bool expect_valid = true;
  OperationResult publication;

  bool Validate(const std::vector<std::uint8_t>& bytes, std::string* error) {
    ++validator_calls;
    no_open_clipboard_window = GetOpenClipboardWindow() == nullptr;
    clipboard_reopened = no_open_clipboard_window &&
                         OpenClipboard(adapter->Window()) != FALSE;
    if (clipboard_reopened) {
      clipboard_reclosed = CloseClipboard() != FALSE;
    }
    if (clipboard_reclosed) {
      publication = adapter->Publish(captured_revision, {next_clipboard_text});
    }
    ++wic_calls;
    wic_valid = ValidatePngPixels(bytes, error);
    return wic_valid;
  }
};

bool CaptureValidatesPngAfterClose(Win32ClipboardAdapter* adapter,
                                   const FormatPayload& png,
                                   bool expect_valid) {
  std::uint32_t baseline_revision = 0;
  if (expect_valid) {
    const OperationResult baseline_publish =
        adapter->Publish(adapter->Revision(), {png});
    if (baseline_publish.status != OperationStatus::committed) return false;
    baseline_revision = baseline_publish.observed_revision;
  } else {
    if (!SetRawPngClipboard(adapter, png)) return false;
    baseline_revision = adapter->Revision();
  }

  PngCaptureValidationEvidence evidence;
  evidence.adapter = adapter;
  evidence.captured_revision = baseline_revision;
  evidence.expect_valid = expect_valid;
  evidence.next_clipboard_text = test_fixtures::MakeText(CF_UNICODETEXT);
  ClipboardPngTestAccess::SetValidator(
      adapter, [&evidence](const std::vector<std::uint8_t>& bytes,
                           std::string* error) {
        return evidence.Validate(bytes, error);
      });
  PngValidatorReset restore_validator(adapter);

  ClipboardSnapshot snapshot;
  const OperationResult captured =
      adapter->Capture(evidence.captured_revision, &snapshot);
  const auto expected_status =
      expect_valid ? OperationStatus::committed
                   : OperationStatus::partial_capture;
  const bool snapshot_matches =
      expect_valid
          ? SamePngCapture(png, snapshot)
          : snapshot.formats.empty() &&
                snapshot.missing_keys == std::vector<std::string>{"png"};
  return captured.status == expected_status &&
         captured.expected_revision == evidence.captured_revision &&
         captured.observed_revision == evidence.publication.observed_revision &&
         captured.observed_revision == adapter->Revision() &&
         snapshot.revision_before_open == evidence.captured_revision &&
         snapshot.revision_after_materialization == evidence.captured_revision &&
         snapshot_matches &&
         evidence.validator_calls == 1 && evidence.wic_calls == 1 &&
         evidence.no_open_clipboard_window && evidence.clipboard_reopened &&
         evidence.clipboard_reclosed &&
         evidence.wic_valid == evidence.expect_valid &&
         evidence.publication.status == OperationStatus::committed &&
         evidence.publication.observed_revision != evidence.captured_revision;
}

std::uint32_t ReadBigEndian32(const std::uint8_t* bytes) {
  return (static_cast<std::uint32_t>(bytes[0]) << 24) |
         (static_cast<std::uint32_t>(bytes[1]) << 16) |
         (static_cast<std::uint32_t>(bytes[2]) << 8) |
         static_cast<std::uint32_t>(bytes[3]);
}

void WriteBigEndian32(std::vector<std::uint8_t>* bytes, std::size_t offset,
                      std::uint32_t value) {
  (*bytes)[offset] = static_cast<std::uint8_t>(value >> 24);
  (*bytes)[offset + 1] = static_cast<std::uint8_t>(value >> 16);
  (*bytes)[offset + 2] = static_cast<std::uint8_t>(value >> 8);
  (*bytes)[offset + 3] = static_cast<std::uint8_t>(value);
}

std::uint32_t Crc32(const std::uint8_t* bytes, std::size_t size) {
  std::uint32_t crc = 0xffffffffu;
  for (std::size_t index = 0; index < size; ++index) {
    crc ^= bytes[index];
    for (int bit = 0; bit < 8; ++bit) {
      crc = (crc & 1u) != 0 ? (crc >> 1) ^ 0xedb88320u : crc >> 1;
    }
  }
  return crc ^ 0xffffffffu;
}

bool RebuildChunkCrc(std::vector<std::uint8_t>* bytes,
                     std::size_t type_offset, std::size_t data_length) {
  if (type_offset > bytes->size() ||
      bytes->size() - type_offset < data_length + 8) {
    return false;
  }
  const std::size_t crc_offset = type_offset + 4 + data_length;
  WriteBigEndian32(bytes, crc_offset,
                   Crc32(bytes->data() + type_offset, 4 + data_length));
  return true;
}

bool PublishRejectedWithoutChangingPng(Win32ClipboardAdapter* adapter,
                                       UINT format_id,
                                       const FormatPayload& invalid) {
  const FormatPayload baseline = test_fixtures::MakePng(format_id);
  const OperationResult baseline_publish =
      adapter->Publish(adapter->Revision(), {baseline});
  if (baseline_publish.status != OperationStatus::committed) return false;

  const std::uint32_t baseline_revision = baseline_publish.observed_revision;
  ClipboardSnapshot before;
  const OperationResult before_capture =
      adapter->Capture(baseline_revision, &before);
  if (before_capture.status != OperationStatus::committed ||
      !SamePngCapture(baseline, before) ||
      adapter->Revision() != baseline_revision) {
    return false;
  }

  const OperationResult rejected =
      adapter->Publish(baseline_revision, {invalid});
  const bool rejected_before_open =
      rejected.status == OperationStatus::invalid_request &&
      !rejected.clipboard_may_have_changed &&
      rejected.observed_revision == baseline_revision &&
      rejected.reason.find("clipboard was not opened") != std::string::npos &&
      adapter->Revision() == baseline_revision;

  ClipboardSnapshot after;
  const OperationResult after_capture =
      adapter->Capture(baseline_revision, &after);
  return rejected_before_open &&
         after_capture.status == OperationStatus::committed &&
         SamePngCapture(baseline, after) && SamePngCapture(baseline, before);
}

}  // namespace

std::vector<CaseResult> RunPngFormatCases(Win32ClipboardAdapter* adapter) {
  if (adapter == nullptr || adapter->Window() == nullptr) {
    return AllNotRun("adapter-unavailable");
  }
  if (!IsPrivateProbeStation(adapter)) {
    return AllNotRun("private-station-required");
  }

  const UINT png_id = RegisterClipboardFormatW(L"PNG");
  if (png_id == 0) return AllNotRun("png-format-registration-failed");

  std::vector<CaseResult> results;
  results.reserve(kCaseIds.size());

  const FormatPayload png8 = test_fixtures::MakePng(png_id);
  const bool png8_round_trip = RoundTripPng(adapter, png8);
  Add(&results, kCaseIds[0], png8_round_trip ? "pass" : "fail",
      png8_round_trip ? "png-bytes-preserved-after-wic-roundtrip"
                      : "png-wic-roundtrip-failed");

  const FormatPayload png16 = Make16BitAlphaPng(png_id);
  clipboard_codecs::PngLayout png16_layout;
  const bool png16_fixture =
      clipboard_codecs::AnalyzePng(png16.bytes.data(), png16.bytes.size(),
                                   &png16_layout) &&
      png16_layout.bit_depth == 16 && png16_layout.color_type == 6;
  const bool png16_round_trip =
      png16_fixture && RoundTripPng(adapter, png16);
  Add(&results, kCaseIds[1], png16_round_trip ? "pass" : "fail",
      png16_round_trip ? "16bit-alpha-original-bytes-preserved"
                       : "16bit-alpha-wic-roundtrip-failed");

  FormatPayload invalid_idat = test_fixtures::MakePng(png_id);
  constexpr std::size_t kFixtureIdatTypeOffset = 37;
  constexpr std::size_t kFixtureIdatDataOffset = 41;
  constexpr std::size_t kFixtureIdatDataLength = 11;
  const bool invalid_idat_fixture_ready =
      invalid_idat.bytes.size() == 68 &&
      std::memcmp(invalid_idat.bytes.data() + kFixtureIdatTypeOffset, "IDAT",
                  4) == 0 &&
      ReadBigEndian32(invalid_idat.bytes.data() + kFixtureIdatTypeOffset - 4) ==
          kFixtureIdatDataLength;
  bool invalid_idat_structural = false;
  if (invalid_idat_fixture_ready) {
    invalid_idat.bytes[kFixtureIdatDataOffset] = 0x00;
    invalid_idat_structural =
        RebuildChunkCrc(&invalid_idat.bytes, kFixtureIdatTypeOffset,
                        kFixtureIdatDataLength);
    clipboard_codecs::PngLayout layout;
    invalid_idat_structural =
        invalid_idat_structural &&
        clipboard_codecs::AnalyzePng(invalid_idat.bytes.data(),
                                     invalid_idat.bytes.size(), &layout) &&
        layout.logical_bytes == invalid_idat.bytes.size();
  }
  const bool invalid_idat_rejected =
      invalid_idat_structural &&
      PublishRejectedWithoutChangingPng(adapter, png_id, invalid_idat);
  Add(&results, kCaseIds[2], invalid_idat_rejected ? "pass" : "fail",
      invalid_idat_rejected
          ? "invalid-zlib-idat-rejected-before-open-and-clear"
          : "invalid-zlib-idat-was-not-safely-rejected");

  FormatPayload oversized = test_fixtures::MakePng(png_id);
  constexpr std::size_t kFixtureIhdrTypeOffset = 12;
  constexpr std::size_t kFixtureIhdrDataOffset = 16;
  const bool oversized_fixture_ready = oversized.bytes.size() == 68;
  bool pixel_budget_rejected = false;
  if (oversized_fixture_ready) {
    WriteBigEndian32(&oversized.bytes, kFixtureIhdrDataOffset, 8192);
    WriteBigEndian32(&oversized.bytes, kFixtureIhdrDataOffset + 4, 8192);
    const bool crc_ready =
        RebuildChunkCrc(&oversized.bytes, kFixtureIhdrTypeOffset, 13);
    clipboard_codecs::PngLayout layout;
    std::string analyze_error;
    const bool over_budget =
        crc_ready &&
        !clipboard_codecs::AnalyzePng(oversized.bytes.data(),
                                      oversized.bytes.size(), &layout,
                                      &analyze_error) &&
        analyze_error == "PNG pixel count exceeds its budget";
    pixel_budget_rejected =
        over_budget &&
        PublishRejectedWithoutChangingPng(adapter, png_id, oversized);
  }
  Add(&results, kCaseIds[3], pixel_budget_rejected ? "pass" : "fail",
      pixel_budget_rejected
          ? "pixel-budget-rejected-before-open-and-clear"
          : "oversized-png-was-not-safely-rejected");

  const bool capture_validation_after_close =
      invalid_idat_structural &&
      CaptureValidatesPngAfterClose(adapter, png8, true) &&
      CaptureValidatesPngAfterClose(adapter, invalid_idat, false);
  Add(&results, kCaseIds[4],
      capture_validation_after_close ? "pass" : "fail",
      capture_validation_after_close
          ? "actual-wic-ran-after-clipboard-close-and-kept-captured-revision"
          : "capture-wic-lock-boundary-or-revision-check-failed");

  return results;
}

}  // namespace clipboard_format_probe
