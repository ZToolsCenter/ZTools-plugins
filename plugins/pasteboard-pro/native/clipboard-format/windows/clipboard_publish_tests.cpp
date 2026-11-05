#include "clipboard_publish_tests.h"

#include "clipboard_formats.h"
#include "clipboard_self_test_fixtures.h"
#include "clipboard_resource_session.h"

#include <cstdint>
#include <functional>
#include <string>
#include <utility>
#include <vector>

namespace clipboard_format_probe {

class ClipboardPublishVerificationTestAccess final {
 public:
  static void SetReader(Win32ClipboardAdapter* adapter,
                        std::function<HANDLE(UINT)> reader) {
    adapter->publish_readback_reader_for_testing_ = std::move(reader);
  }

  static void SetTransform(
      Win32ClipboardAdapter* adapter,
      std::function<void(UINT, FormatPayload*)> transform) {
    adapter->publish_readback_transform_for_testing_ =
        std::move(transform);
  }

  static void SetAfterClose(Win32ClipboardAdapter* adapter,
                            std::function<void()> hook) {
    adapter->publish_after_close_hook_for_testing_ = std::move(hook);
  }
};

namespace {

constexpr const char* kCaseIds[] = {
    "publish-readback-real-plan-verified",
    "publish-readback-failure-or-throw-is-unconfirmed",
    "publish-readback-single-key-mismatch-partition",
    "publish-set-fault-remains-partial-subset",
    "publish-readback-close-race-is-unconfirmed",
    "publish-bitmap-header-padding-is-compatible",
    "publish-bitmap-rgb-difference-is-mismatch",
};

void Add(std::vector<CaseResult>* result, const char* id, bool passed) {
  result->push_back(CaseResult{
      id, passed ? "pass" : "fail",
      passed ? "publish-verification-case-passed"
             : "publish-verification-case-failed"});
}

void AddNotRun(std::vector<CaseResult>* result, const char* detail) {
  for (const char* id : kCaseIds) {
    result->push_back(CaseResult{id, "not-run", detail});
  }
}

bool ReadObjectName(HANDLE object, std::wstring* name) {
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
  if (!ReadObjectName(station, &station_name) ||
      !ReadObjectName(desktop, &desktop_name) ||
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

class PublishReadbackHookReset final {
 public:
  explicit PublishReadbackHookReset(Win32ClipboardAdapter* adapter)
      : adapter_(adapter) {}
  PublishReadbackHookReset(const PublishReadbackHookReset&) = delete;
  PublishReadbackHookReset& operator=(const PublishReadbackHookReset&) = delete;
  ~PublishReadbackHookReset() {
    ClipboardPublishVerificationTestAccess::SetReader(adapter_, {});
    ClipboardPublishVerificationTestAccess::SetTransform(adapter_, {});
    ClipboardPublishVerificationTestAccess::SetAfterClose(adapter_, {});
  }

 private:
  Win32ClipboardAdapter* adapter_;
};

std::vector<FormatPayload> MakePlan() {
  const UINT rtf_id = RegisterClipboardFormatW(L"Rich Text Format");
  if (rtf_id == 0) return {};
  return {test_fixtures::MakeText(CF_UNICODETEXT),
          test_fixtures::MakeRtf(rtf_id)};
}

FormatPayload MakeBitmapPlan() {
  FormatPayload bitmap;
  bitmap.key = "bitmap";
  bitmap.native_name = L"CF_BITMAP";
  bitmap.format_id = CF_BITMAP;
  bitmap.encoding = "dib24-rendered";
  bitmap.fidelity = "visible-rgb-compatible";
  bitmap.source_format = "CF_BITMAP";
  bitmap.source_origin = "unknown";
  bitmap.materialization = "win32-getdibits-24bpp-top-down";
  bitmap.bytes.assign(44, 0);
  const auto write32 = [&bitmap](std::size_t offset, std::uint32_t value) {
    for (std::size_t index = 0; index < 4; ++index) {
      bitmap.bytes[offset + index] =
          static_cast<std::uint8_t>((value >> (index * 8)) & 0xff);
    }
  };
  bitmap.bytes[0] = 40;
  write32(4, 1);
  write32(8, static_cast<std::uint32_t>(-1));
  bitmap.bytes[12] = 1;
  bitmap.bytes[14] = 24;
  write32(20, 4);
  bitmap.bytes[40] = 0x21;
  bitmap.bytes[41] = 0x43;
  bitmap.bytes[42] = 0x65;
  bitmap.bytes[43] = 0x7a;
  return bitmap;
}

bool SameVisiblePixelBytes(const FormatPayload& left,
                           const FormatPayload& right) {
  return left.bytes.size() == 44 && right.bytes.size() == 44 &&
         left.bytes[40] == right.bytes[40] &&
         left.bytes[41] == right.bytes[41] &&
         left.bytes[42] == right.bytes[42];
}

bool IsUnconfirmed(const OperationResult& result,
                   const std::vector<FormatPayload>& plan,
                   const Win32ClipboardAdapter* adapter) {
  std::vector<std::string> keys;
  for (const auto& format : plan) keys.push_back(format.key);
  return result.status == OperationStatus::partial_write &&
         result.reason == "publication-unconfirmed" &&
         result.clipboard_may_have_changed && result.written_keys == keys &&
         result.missing_keys.empty() &&
         result.write_revision.has_value() &&
         result.observed_revision == adapter->Revision();
}

}  // namespace

std::vector<CaseResult> RunPublishVerificationCases(
    Win32ClipboardAdapter* adapter) {
  std::vector<CaseResult> result;
  if (adapter == nullptr || !adapter->IsInitialized()) {
    AddNotRun(&result, "adapter-unavailable");
    return result;
  }
  if (!IsPrivateProbeStation(adapter)) {
    AddNotRun(&result, "private-station-required");
    return result;
  }
  const auto plan = MakePlan();
  if (plan.size() != 2) {
    AddNotRun(&result, "format-registration-failed");
    return result;
  }

  PublishReadbackHookReset restore_hooks(adapter);
  ClipboardPublishVerificationTestAccess::SetReader(adapter, {});
  ClipboardPublishVerificationTestAccess::SetTransform(adapter, {});
  std::vector<std::string> planned_keys;
  for (const auto& format : plan) planned_keys.push_back(format.key);

  const OperationResult verified = adapter->Publish(adapter->Revision(), plan);
  Add(&result, kCaseIds[0],
      verified.status == OperationStatus::committed &&
          verified.clipboard_may_have_changed &&
          verified.written_keys == planned_keys &&
          verified.missing_keys.empty() && verified.reason.empty() &&
      verified.write_revision.has_value() &&
      verified.write_revision == verified.observed_revision &&
          verified.observed_revision == adapter->Revision());

  ClipboardPublishVerificationTestAccess::SetReader(
      adapter, [](UINT) -> HANDLE { return nullptr; });
  const OperationResult unreadable = adapter->Publish(adapter->Revision(), plan);
  const bool read_failure_is_unconfirmed = IsUnconfirmed(unreadable, plan, adapter);

  ClipboardPublishVerificationTestAccess::SetReader(
      adapter, [](UINT) -> HANDLE { throw 1; });
  const OperationResult thrown = adapter->Publish(adapter->Revision(), plan);
  Add(&result, kCaseIds[1], read_failure_is_unconfirmed &&
                                IsUnconfirmed(thrown, plan, adapter));

  ClipboardPublishVerificationTestAccess::SetReader(adapter, {});
  ClipboardPublishVerificationTestAccess::SetTransform(
      adapter, [rtf_id = plan[1].format_id](UINT format_id,
                                            FormatPayload* readback) {
        if (format_id == rtf_id && readback != nullptr &&
            !readback->bytes.empty()) {
          readback->bytes.front() ^= 0x01;
        }
      });
  const OperationResult mismatch = adapter->Publish(adapter->Revision(), plan);
  Add(&result, kCaseIds[2],
      mismatch.status == OperationStatus::partial_write &&
          mismatch.reason == "publication-readback-mismatch" &&
          mismatch.clipboard_may_have_changed &&
          mismatch.written_keys == std::vector<std::string>{plan[0].key} &&
          mismatch.missing_keys == std::vector<std::string>{plan[1].key} &&
          mismatch.observed_revision == adapter->Revision());

  ClipboardPublishVerificationTestAccess::SetTransform(adapter, {});
  const OperationResult set_fault =
      adapter->Publish(adapter->Revision(), plan, std::size_t{1});
  Add(&result, kCaseIds[3],
      set_fault.status == OperationStatus::partial_write &&
          set_fault.clipboard_may_have_changed &&
          set_fault.reason == "test fault injected before SetClipboardData" &&
          set_fault.written_keys == std::vector<std::string>{plan[0].key} &&
          set_fault.missing_keys == std::vector<std::string>{plan[1].key} &&
          set_fault.reason != "publication-unconfirmed");

  auto new_text = test_fixtures::MakeText(CF_UNICODETEXT);
  new_text.bytes[0] = 'N';
  new_text.bytes[1] = 0;
  OperationResult replacement;
  std::size_t after_close_calls = 0;
  ClipboardPublishVerificationTestAccess::SetAfterClose(
      adapter, [&]() {
        ClipboardPublishVerificationTestAccess::SetAfterClose(adapter, {});
        ++after_close_calls;
        replacement = adapter->Publish(adapter->Revision(), {new_text});
      });
  const OperationResult close_race = adapter->Publish(adapter->Revision(), plan);
  const bool current_content_is_replacement = [&]() {
    if (!OpenClipboard(adapter->Window())) return false;
    ClipboardResourceSession session;
    FormatPayload actual = new_text;
    actual.bytes.clear();
    std::string error;
    const bool text_matches =
        CopyGlobalMemory(GetClipboardData(CF_UNICODETEXT), &actual, &error) &&
        actual.bytes == new_text.bytes;
    const bool old_rtf_absent = GetClipboardData(plan[1].format_id) == nullptr;
    const bool closed = session.Close();
    return text_matches && old_rtf_absent && closed;
  }();
  Add(&result, kCaseIds[4],
      after_close_calls == 1 && replacement.status == OperationStatus::committed &&
          replacement.write_revision.has_value() &&
          close_race.status == OperationStatus::partial_write &&
          close_race.reason == "publication-unconfirmed" &&
          close_race.clipboard_may_have_changed &&
          close_race.written_keys == planned_keys &&
          close_race.missing_keys.empty() &&
          close_race.write_revision.has_value() &&
          close_race.write_revision != close_race.observed_revision &&
          close_race.observed_revision == replacement.write_revision &&
          close_race.observed_revision == adapter->Revision() &&
          current_content_is_replacement);

  const FormatPayload bitmap = MakeBitmapPlan();
  bool compatible_transform_applied = false;
  ClipboardPublishVerificationTestAccess::SetReader(adapter, {});
  ClipboardPublishVerificationTestAccess::SetTransform(
      adapter, [&bitmap, &compatible_transform_applied](
                   UINT format_id, FormatPayload* readback) {
        if (format_id != CF_BITMAP || readback == nullptr ||
            readback->bytes.size() != 44) {
          return;
        }
        readback->bytes[24] = 0x13;
        readback->bytes[25] = 0x0b;
        readback->bytes[26] = 0x00;
        readback->bytes[27] = 0x00;
        readback->bytes[43] ^= 0x5a;
        compatible_transform_applied =
            readback->bytes != bitmap.bytes &&
            SameVisiblePixelBytes(bitmap, *readback);
      });
  const OperationResult compatible_bitmap =
      adapter->Publish(adapter->Revision(), {bitmap});
  Add(&result, kCaseIds[5],
      compatible_transform_applied &&
          compatible_bitmap.status == OperationStatus::committed &&
          compatible_bitmap.written_keys ==
              std::vector<std::string>{bitmap.key} &&
          compatible_bitmap.missing_keys.empty() &&
          compatible_bitmap.write_revision.has_value() &&
          compatible_bitmap.observed_revision ==
              compatible_bitmap.write_revision);

  bool rgb_transform_applied = false;
  ClipboardPublishVerificationTestAccess::SetTransform(
      adapter, [&bitmap, &rgb_transform_applied](UINT format_id,
                                                 FormatPayload* readback) {
        if (format_id != CF_BITMAP || readback == nullptr ||
            readback->bytes.size() != 44) {
          return;
        }
        readback->bytes[40] ^= 0x01;
        rgb_transform_applied =
            readback->bytes != bitmap.bytes &&
            !SameVisiblePixelBytes(bitmap, *readback);
      });
  const OperationResult different_rgb =
      adapter->Publish(adapter->Revision(), {bitmap});
  const bool rgb_difference_mismatches =
      rgb_transform_applied &&
      different_rgb.status == OperationStatus::partial_write &&
      different_rgb.reason == "publication-readback-mismatch" &&
      different_rgb.clipboard_may_have_changed &&
      different_rgb.written_keys.empty() &&
      different_rgb.missing_keys == std::vector<std::string>{bitmap.key};

  bool metadata_transform_applied = false;
  ClipboardPublishVerificationTestAccess::SetTransform(
      adapter, [&metadata_transform_applied](UINT format_id,
                                             FormatPayload* readback) {
        if (format_id == CF_BITMAP && readback != nullptr) {
          readback->fidelity = "unverified-rendering";
          metadata_transform_applied = true;
        }
      });
  const OperationResult changed_metadata =
      adapter->Publish(adapter->Revision(), {bitmap});
  Add(&result, kCaseIds[6],
      rgb_difference_mismatches && metadata_transform_applied &&
          changed_metadata.status == OperationStatus::partial_write &&
          changed_metadata.reason == "publication-readback-mismatch" &&
          changed_metadata.clipboard_may_have_changed &&
          changed_metadata.written_keys.empty() &&
          changed_metadata.missing_keys ==
              std::vector<std::string>{bitmap.key});

  return result;
}

}  // namespace clipboard_format_probe
