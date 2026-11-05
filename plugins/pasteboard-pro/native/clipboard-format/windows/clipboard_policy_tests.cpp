#include "clipboard_policy_tests.h"

#include <algorithm>
#include <cstring>
#include <functional>
#include <string>
#include <utility>
#include <vector>

namespace clipboard_format_probe {

class ClipboardPolicyTestAccess final {
 public:
  static void SetOrdinaryReader(Win32ClipboardAdapter* adapter,
                                std::function<HANDLE(UINT)> reader) {
    adapter->ordinary_reader_for_testing_ = std::move(reader);
  }
};

namespace {

constexpr const char* kCaseIds[] = {
    "policy-pause-blocks-ordinary",
    "policy-excluded-executable-blocks-ordinary",
    "policy-strict-unknown-blocks-ordinary",
    "policy-monitor-exclusion-blocks-ordinary",
    "policy-history-zero-blocks-ordinary",
    "policy-cloud-zero-keeps-local",
    "policy-invalid-history-blocks-ordinary",
    "policy-invalid-cloud-keeps-local",
    "policy-denial-clears-old-output",
    "policy-unknown-owner-stays-unknown",
    "policy-windows-path-identity-comparison",
    "policy-windows-aumid-exact-match",
    "policy-windows-aumid-case-sensitive",
    "policy-windows-aumid-different-namespace",
    "policy-windows-aumid-prefix-is-not-equal",
    "policy-history-one-keeps-user-policy",
    "policy-cloud-one-keeps-user-policy",
    "policy-owner-is-not-content-origin",
};

void Add(std::vector<CaseResult>* result, const char* id, bool passed) {
  result->push_back(CaseResult{
      id, passed ? "pass" : "fail",
      passed ? "policy-case-passed" : "policy-case-failed"});
}

void AddNotRun(std::vector<CaseResult>* result,
               const char* detail = "adapter-unavailable") {
  for (const char* id : kCaseIds) {
    result->push_back(CaseResult{id, "not-run", detail});
  }
}

bool ReadObjectName(HANDLE object, std::wstring* name) {
  DWORD required_bytes = 0;
  GetUserObjectInformationW(object, UOI_NAME, nullptr, 0, &required_bytes);
  if (required_bytes < sizeof(wchar_t) || required_bytes > 65536) return false;
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

bool WriteMemoryFormat(UINT format, const std::vector<std::uint8_t>& bytes) {
  HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, bytes.empty() ? 1 : bytes.size());
  if (memory == nullptr) return false;
  void* target = GlobalLock(memory);
  if (target == nullptr) {
    GlobalFree(memory);
    return false;
  }
  if (!bytes.empty()) std::memcpy(target, bytes.data(), bytes.size());
  GlobalUnlock(memory);
  if (SetClipboardData(format, memory) == nullptr) {
    GlobalFree(memory);
    return false;
  }
  return true;
}

bool SetTestClipboard(Win32ClipboardAdapter* adapter, bool include_text,
                      std::vector<std::pair<UINT, std::vector<std::uint8_t>>>
                          markers = {}) {
  if (adapter == nullptr || adapter->Window() == nullptr ||
      !OpenClipboard(adapter->Window())) {
    return false;
  }
  bool passed = EmptyClipboard() != FALSE;
  if (passed && include_text) {
    const std::wstring sample = L"synthetic clipboard-policy test";
    std::vector<std::uint8_t> bytes((sample.size() + 1) * sizeof(wchar_t));
    std::memcpy(bytes.data(), sample.c_str(), bytes.size());
    passed = WriteMemoryFormat(CF_UNICODETEXT, bytes);
  }
  for (const auto& marker : markers) {
    if (!passed) break;
    passed = WriteMemoryFormat(marker.first, marker.second);
  }
  const bool closed = CloseClipboard() != FALSE;
  return passed && closed;
}

bool SetUnknownOwnerEmptyClipboard() {
  if (!OpenClipboard(nullptr)) return false;
  const bool emptied = EmptyClipboard() != FALSE;
  const bool closed = CloseClipboard() != FALSE;
  return emptied && closed && GetClipboardOwner() == nullptr;
}

std::vector<std::uint8_t> MarkerDword(DWORD value) {
  std::vector<std::uint8_t> bytes(sizeof(value));
  std::memcpy(bytes.data(), &value, sizeof(value));
  return bytes;
}

bool CurrentProcessImagePath(std::wstring* path) {
  std::vector<wchar_t> buffer(32768, L'\0');
  DWORD length = static_cast<DWORD>(buffer.size());
  if (!QueryFullProcessImageNameW(GetCurrentProcess(), 0, buffer.data(),
                                  &length) ||
      length == 0 || length > buffer.size()) {
    return false;
  }
  path->assign(buffer.data(), length);
  return true;
}

struct ReaderCounter {
  Win32ClipboardAdapter* adapter;
  std::size_t count = 0;

  explicit ReaderCounter(Win32ClipboardAdapter* value) : adapter(value) {
    ClipboardPolicyTestAccess::SetOrdinaryReader(adapter, [this](UINT format) {
      ++count;
      return GetClipboardData(format);
    });
  }

  ~ReaderCounter() {
    ClipboardPolicyTestAccess::SetOrdinaryReader(adapter, {});
  }
};

OperationResult CaptureCurrent(Win32ClipboardAdapter* adapter,
                               ClipboardSnapshot* output) {
  return adapter->Capture(adapter->Revision(), output);
}

}  // namespace

std::vector<CaseResult> RunPolicyFormatCases(
    Win32ClipboardAdapter* adapter) {
  std::vector<CaseResult> result;
  if (adapter == nullptr || !adapter->IsInitialized()) {
    AddNotRun(&result);
    return result;
  }
  if (!IsPrivateProbeStation(adapter)) {
    AddNotRun(&result, "private-station-required");
    return result;
  }

  const CapturePolicyConfig original_policy = adapter->CapturePolicyOptions();
  adapter->SetCapturePolicy(CapturePolicyConfig{});

  const UINT monitor_exclusion =
      RegisterClipboardFormatW(L"ExcludeClipboardContentFromMonitorProcessing");
  const UINT history_marker =
      RegisterClipboardFormatW(L"CanIncludeInClipboardHistory");
  const UINT cloud_marker =
      RegisterClipboardFormatW(L"CanUploadToCloudClipboard");
  if (monitor_exclusion == 0 || history_marker == 0 || cloud_marker == 0) {
    for (const char* id : kCaseIds) Add(&result, id, false);
    adapter->SetCapturePolicy(original_policy);
    return result;
  }

  CapturePolicyConfig policy;
  ClipboardSnapshot output;
  OperationResult captured;
  std::size_t read_count = 0;

  policy.paused = true;
  adapter->SetCapturePolicy(policy);
  bool setup = SetTestClipboard(adapter, true);
  {
    ReaderCounter reader(adapter);
    captured = CaptureCurrent(adapter, &output);
    read_count = reader.count;
  }
  Add(&result, kCaseIds[0],
      setup && captured.status == OperationStatus::policy_denied &&
          read_count == 0 && output.formats.empty());

  policy = CapturePolicyConfig{};
  std::wstring own_path;
  setup = CurrentProcessImagePath(&own_path) &&
          SetTestClipboard(adapter, true);
  policy.excluded_executable_paths.push_back(own_path);
  adapter->SetCapturePolicy(policy);
  {
    ReaderCounter reader(adapter);
    captured = CaptureCurrent(adapter, &output);
    read_count = reader.count;
  }
  Add(&result, kCaseIds[1],
      setup && captured.status == OperationStatus::policy_denied &&
          read_count == 0 && output.formats.empty());

  policy = CapturePolicyConfig{};
  policy.strict_unknown_source = true;
  adapter->SetCapturePolicy(policy);
  setup = SetUnknownOwnerEmptyClipboard();
  {
    ReaderCounter reader(adapter);
    captured = CaptureCurrent(adapter, &output);
    read_count = reader.count;
  }
  Add(&result, kCaseIds[2],
      setup && captured.status == OperationStatus::policy_denied &&
          read_count == 0 && output.formats.empty());

  policy = CapturePolicyConfig{};
  adapter->SetCapturePolicy(policy);
  setup = SetTestClipboard(adapter, true, {{monitor_exclusion, {0}}});
  {
    ReaderCounter reader(adapter);
    captured = CaptureCurrent(adapter, &output);
    read_count = reader.count;
  }
  Add(&result, kCaseIds[3],
      setup && captured.status == OperationStatus::policy_denied &&
          read_count == 0 && output.formats.empty());

  policy = CapturePolicyConfig{};
  adapter->SetCapturePolicy(policy);
  setup = SetTestClipboard(adapter, true,
                           {{history_marker, MarkerDword(0)}});
  {
    ReaderCounter reader(adapter);
    captured = CaptureCurrent(adapter, &output);
    read_count = reader.count;
  }
  Add(&result, kCaseIds[4],
      setup && captured.status == OperationStatus::policy_denied &&
          read_count == 0 && output.formats.empty());

  policy = CapturePolicyConfig{};
  adapter->SetCapturePolicy(policy);
  setup = SetTestClipboard(adapter, true,
                           {{cloud_marker, MarkerDword(0)}});
  {
    ReaderCounter reader(adapter);
    captured = CaptureCurrent(adapter, &output);
    read_count = reader.count;
  }
  Add(&result, kCaseIds[5],
      setup && captured.status == OperationStatus::committed &&
          read_count > 0 && !output.formats.empty() &&
          output.capture_policy.local_history_permitted &&
          output.owner_process_id != 0 &&
          output.capture_policy.owner_process_identity_known &&
          output.capture_policy.owner_process_instance_confirmed &&
          output.capture_policy.owner_evidence ==
              ClipboardOwnerEvidence::clipboard_owner_window &&
          output.capture_policy.content_origin_trust ==
              ContentOriginTrust::unknown &&
          !output.capture_policy.cloud_upload_permitted &&
          output.capture_policy.cloud_upload ==
              CloudUploadPermission::marker_denied);

  policy = CapturePolicyConfig{};
  adapter->SetCapturePolicy(policy);
  setup = SetTestClipboard(adapter, true,
                           {{history_marker, MarkerDword(2)}});
  {
    ReaderCounter reader(adapter);
    captured = CaptureCurrent(adapter, &output);
    read_count = reader.count;
  }
  Add(&result, kCaseIds[6],
      setup && captured.status == OperationStatus::policy_denied &&
          read_count == 0 && output.formats.empty());

  policy = CapturePolicyConfig{};
  adapter->SetCapturePolicy(policy);
  setup = SetTestClipboard(adapter, true,
                           {{cloud_marker, MarkerDword(2)}});
  {
    ReaderCounter reader(adapter);
    captured = CaptureCurrent(adapter, &output);
    read_count = reader.count;
  }
  Add(&result, kCaseIds[7],
      setup && captured.status == OperationStatus::committed &&
          read_count > 0 && !output.formats.empty() &&
          output.capture_policy.local_history_permitted &&
          !output.capture_policy.cloud_upload_permitted &&
          output.capture_policy.cloud_upload ==
              CloudUploadPermission::invalid_marker);

  policy = CapturePolicyConfig{};
  adapter->SetCapturePolicy(policy);
  setup = SetTestClipboard(adapter, true);
  captured = CaptureCurrent(adapter, &output);
  const bool captured_before_denial = !output.formats.empty();
  policy.paused = true;
  adapter->SetCapturePolicy(policy);
  {
    ReaderCounter reader(adapter);
    captured = CaptureCurrent(adapter, &output);
    read_count = reader.count;
  }
  Add(&result, kCaseIds[8],
      setup && captured_before_denial &&
          captured.status == OperationStatus::policy_denied &&
          read_count == 0 && output.formats.empty() &&
          !output.capture_policy.capture_allowed);

  policy = CapturePolicyConfig{};
  adapter->SetCapturePolicy(policy);
  setup = SetUnknownOwnerEmptyClipboard();
  {
    ReaderCounter reader(adapter);
    captured = CaptureCurrent(adapter, &output);
    read_count = reader.count;
  }
  Add(&result, kCaseIds[9],
      setup && captured.status == OperationStatus::partial_capture &&
          output.capture_policy.capture_allowed &&
          output.capture_policy.owner_evidence ==
              ClipboardOwnerEvidence::unknown &&
          !output.capture_policy.owner_process_identity_known &&
          !output.capture_policy.owner_process_instance_confirmed &&
          output.capture_policy.content_origin_trust ==
              ContentOriginTrust::unknown);

  Add(&result, kCaseIds[10],
      IsWindowsExecutablePathEqual(L"C:/Program Files/App/App.exe",
                                   L"c:\\program files\\app\\APP.EXE"));
  Add(&result, kCaseIds[11],
      IsWindowsApplicationUserModelIdEqual(L"Contoso.Editor!Main",
                                           L"Contoso.Editor!Main"));
  Add(&result, kCaseIds[12],
      !IsWindowsApplicationUserModelIdEqual(L"Contoso.Editor!Main",
                                            L"contoso.Editor!Main"));
  Add(&result, kCaseIds[13],
      !IsWindowsApplicationUserModelIdEqual(L"Contoso.Editor!Main",
                                            L"Fabrikam.Editor!Main"));
  Add(&result, kCaseIds[14],
      !IsWindowsApplicationUserModelIdEqual(L"Contoso.Editor!Main",
                                            L"Contoso.Editor!MainExtra"));

  policy = CapturePolicyConfig{};
  policy.allow_local_history = false;
  adapter->SetCapturePolicy(policy);
  setup = SetTestClipboard(adapter, true,
                           {{history_marker, MarkerDword(1)}});
  {
    ReaderCounter reader(adapter);
    captured = CaptureCurrent(adapter, &output);
    read_count = reader.count;
  }
  Add(&result, kCaseIds[15],
      setup && captured.status == OperationStatus::policy_denied &&
          read_count == 0 && output.formats.empty());

  policy = CapturePolicyConfig{};
  adapter->SetCapturePolicy(policy);
  setup = SetTestClipboard(adapter, true,
                           {{cloud_marker, MarkerDword(1)}});
  {
    ReaderCounter reader(adapter);
    captured = CaptureCurrent(adapter, &output);
    read_count = reader.count;
  }
  Add(&result, kCaseIds[16],
      setup && captured.status == OperationStatus::committed &&
          read_count > 0 && !output.formats.empty() &&
          output.capture_policy.local_history_permitted &&
          !output.capture_policy.cloud_upload_permitted &&
          output.capture_policy.cloud_upload ==
              CloudUploadPermission::request_ignored_by_user &&
          output.capture_policy.cloud_marker ==
              CaptureMarkerValue::request_allow);

  policy = CapturePolicyConfig{};
  adapter->SetCapturePolicy(policy);
  setup = SetTestClipboard(adapter, true);
  captured = CaptureCurrent(adapter, &output);
  const bool owner_evidence_is_not_trust =
      captured.status == OperationStatus::committed &&
      output.capture_policy.owner_process_identity_known &&
      output.capture_policy.owner_process_instance_confirmed &&
      output.capture_policy.owner_evidence ==
          ClipboardOwnerEvidence::clipboard_owner_window &&
      output.capture_policy.content_origin_trust == ContentOriginTrust::unknown;

  policy.require_trusted_content_origin = true;
  adapter->SetCapturePolicy(policy);
  {
    ReaderCounter reader(adapter);
    captured = CaptureCurrent(adapter, &output);
    read_count = reader.count;
  }
  Add(&result, kCaseIds[17],
      setup && owner_evidence_is_not_trust &&
          captured.status == OperationStatus::policy_denied &&
          read_count == 0 && output.formats.empty());

  SetTestClipboard(adapter, false);
  adapter->SetCapturePolicy(original_policy);
  return result;
}

}  // namespace clipboard_format_probe
