#include "clipboard_api_fault_test_support.h"

#include "clipboard_self_test_fixtures.h"

#include <algorithm>
#include <utility>

namespace clipboard_format_probe {

void ClipboardApiFaultTestAccess::SetFaults(
    Win32ClipboardAdapter* adapter, ClipboardApiFaultPlan* plan) {
  if (adapter != nullptr) adapter->api_faults_for_testing_ = plan;
}

void ClipboardApiFaultTestAccess::SetPreparedObserver(
    Win32ClipboardAdapter* adapter,
    std::function<void(PreparedFormat&)> observer) {
  if (adapter != nullptr) {
    adapter->publish_prepared_observer_for_testing_ = std::move(observer);
  }
}

void ClipboardApiFaultTestAccess::SetOrdinaryReader(
    Win32ClipboardAdapter* adapter, std::function<HANDLE(UINT)> reader) {
  if (adapter != nullptr) {
    adapter->ordinary_reader_for_testing_ = std::move(reader);
  }
}

void ClipboardApiFaultTestAccess::ClearHooks(
    Win32ClipboardAdapter* adapter) {
  if (adapter == nullptr) return;
  adapter->api_faults_for_testing_ = nullptr;
  adapter->publish_prepared_observer_for_testing_ = {};
  adapter->ordinary_reader_for_testing_ = {};
}

namespace api_fault_test {
namespace {

bool ReadObjectName(HANDLE object, std::wstring* name) {
  if (object == nullptr || name == nullptr) return false;
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

const FormatPayload* FindPayload(const ClipboardSnapshot& snapshot,
                                 const std::string& key) {
  const auto found = std::find_if(
      snapshot.formats.begin(), snapshot.formats.end(),
      [&key](const FormatPayload& format) { return format.key == key; });
  return found == snapshot.formats.end() ? nullptr : &*found;
}

bool HasKey(const std::vector<std::string>& keys, const std::string& key) {
  return std::find(keys.begin(), keys.end(), key) != keys.end();
}

}  // namespace

HookScope::HookScope(Win32ClipboardAdapter* adapter)
    : adapter_(adapter),
      original_policy_(adapter != nullptr ? adapter->CapturePolicyOptions()
                                          : CapturePolicyConfig{}) {}

HookScope::~HookScope() {
  ClipboardApiFaultTestAccess::ClearHooks(adapter_);
  if (adapter_ != nullptr) adapter_->SetCapturePolicy(std::move(original_policy_));
}

void HookScope::SetFaults(ClipboardApiFaultPlan* plan) {
  ClipboardApiFaultTestAccess::SetFaults(adapter_, plan);
}

void HookScope::SetObserver(std::function<void(PreparedFormat&)> observer) {
  ClipboardApiFaultTestAccess::SetPreparedObserver(adapter_,
                                                   std::move(observer));
}

void HookScope::SetOrdinaryReader(std::function<HANDLE(UINT)> reader) {
  ClipboardApiFaultTestAccess::SetOrdinaryReader(adapter_, std::move(reader));
}

void HookScope::DisableFaults() { SetFaults(nullptr); }

void HookScope::DisableObserver() { SetObserver({}); }

void HookScope::ClearFaultPlan(ClipboardApiFaultPlan* plan) {
  if (plan != nullptr) *plan = ClipboardApiFaultPlan{};
}

void ReleaseLedger::Attach(PreparedFormat& format) noexcept {
  if (prepared_count_ >= prepared_.size()) {
    overflowed_ = true;
    return;
  }
  PreparedResource& resource = prepared_[prepared_count_++];
  resource.storage = format.storage;
  resource.handle = format.ClipboardHandle();
  try {
    resource.key = format.payload.key;
  } catch (...) {
    overflowed_ = true;
  }
  format.release_observer_for_testing = &ReleaseLedger::Observe;
  format.release_observer_context_for_testing = this;
}

void ReleaseLedger::Observe(PreparedFormat::Storage storage, HANDLE handle,
                            bool transferred, bool attempted, bool succeeded,
                            void* context) noexcept {
  auto* ledger = static_cast<ReleaseLedger*>(context);
  if (ledger == nullptr) return;
  if (ledger->release_count_ >= ledger->events_.size()) {
    ledger->overflowed_ = true;
    return;
  }
  ledger->events_[ledger->release_count_++] =
      ReleaseEvent{storage, handle, transferred, attempted, succeeded};
}

bool ReleaseLedger::IsExactFor(
    const std::vector<FormatPayload>& plan,
    const std::vector<std::string>& transferred_keys) const {
  if (overflowed_ || prepared_count_ != plan.size() ||
      release_count_ != prepared_count_) {
    return false;
  }
  for (std::size_t index = 0; index < prepared_count_; ++index) {
    const PreparedResource& resource = prepared_[index];
    if (resource.storage == PreparedFormat::Storage::none ||
        resource.handle == nullptr || resource.key != plan[index].key) {
      return false;
    }
    const auto expected_transfer =
        HasKey(transferred_keys, resource.key);
    std::size_t matching_events = 0;
    for (std::size_t event_index = 0; event_index < release_count_;
         ++event_index) {
      const ReleaseEvent& event = events_[event_index];
      if (event.storage != resource.storage || event.handle != resource.handle) {
        continue;
      }
      ++matching_events;
      if (event.transferred != expected_transfer ||
          event.attempted == expected_transfer ||
          event.succeeded == expected_transfer) {
        return false;
      }
    }
    if (matching_events != 1) return false;
  }
  return true;
}

bool IsPrivateProbeStation(const Win32ClipboardAdapter* adapter) {
  if (adapter == nullptr || !adapter->IsInitialized()) return false;
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

bool ReadClipboardSnapshot(Win32ClipboardAdapter* adapter,
                           ClipboardSnapshot* snapshot) {
  if (adapter == nullptr || snapshot == nullptr) return false;
  *snapshot = ClipboardSnapshot{};
  const OperationResult result = adapter->Capture(adapter->Revision(), snapshot);
  return result.status == OperationStatus::committed ||
         result.status == OperationStatus::partial_capture ||
         result.status == OperationStatus::unsupported_format;
}

bool HasExactPayload(const ClipboardSnapshot& snapshot,
                     const FormatPayload& expected) {
  const FormatPayload* actual = FindPayload(snapshot, expected.key);
  return actual != nullptr && actual->format_id == expected.format_id &&
         actual->bytes == expected.bytes;
}

bool HasExactPrefix(const ClipboardSnapshot& snapshot,
                    const std::vector<FormatPayload>& plan,
                    std::size_t prefix_length) {
  if (prefix_length > plan.size()) return false;
  for (std::size_t index = 0; index < plan.size(); ++index) {
    const bool expected = index < prefix_length;
    const bool actual = FindPayload(snapshot, plan[index].key) != nullptr;
    if (actual != expected) return false;
    if (expected && !HasExactPayload(snapshot, plan[index])) return false;
  }
  return true;
}

bool HasNoPlannedPayload(const ClipboardSnapshot& snapshot,
                         const std::vector<FormatPayload>& plan) {
  return HasExactPrefix(snapshot, plan, 0);
}

bool SeedAndCaptureBaseline(Win32ClipboardAdapter* adapter,
                            ClipboardSnapshot* snapshot,
                            FormatPayload* expected_text) {
  if (adapter == nullptr || snapshot == nullptr || expected_text == nullptr) {
    return false;
  }
  *expected_text = test_fixtures::MakeText(CF_UNICODETEXT);
  const OperationResult publish = adapter->Publish(
      adapter->Revision(), std::vector<FormatPayload>{*expected_text});
  return publish.status == OperationStatus::committed &&
         ReadClipboardSnapshot(adapter, snapshot) &&
         HasExactPayload(*snapshot, *expected_text);
}

std::vector<FormatPayload> MakeThreeGlobalFormatPlan(UINT html_id,
                                                     UINT rtf_id) {
  if (html_id == 0 || rtf_id == 0) return {};
  return {test_fixtures::MakeText(CF_UNICODETEXT),
          test_fixtures::MakeHtml(html_id), test_fixtures::MakeRtf(rtf_id)};
}

std::vector<std::string> KeysThrough(const std::vector<FormatPayload>& plan,
                                     std::size_t length) {
  std::vector<std::string> keys;
  length = std::min(length, plan.size());
  keys.reserve(length);
  for (std::size_t index = 0; index < length; ++index) {
    keys.push_back(plan[index].key);
  }
  return keys;
}

std::vector<std::string> KeysAfter(const std::vector<FormatPayload>& plan,
                                   std::size_t length) {
  std::vector<std::string> keys;
  length = std::min(length, plan.size());
  keys.reserve(plan.size() - length);
  for (std::size_t index = length; index < plan.size(); ++index) {
    keys.push_back(plan[index].key);
  }
  return keys;
}

bool SameKeys(const std::vector<std::string>& left,
              const std::vector<std::string>& right) {
  return left == right;
}

bool CountsEqual(const ClipboardApiFaultPlan& plan, ClipboardApiCall call,
                 std::size_t attempts, std::size_t native_calls) {
  const std::size_t index = static_cast<std::size_t>(call);
  return index < plan.attempts.size() && plan.attempts[index] == attempts &&
         plan.native_calls[index] == native_calls;
}

void ConfigureFailure(ClipboardApiFaultPlan* plan, ClipboardApiCall call,
                      std::size_t first_failure_call,
                      std::size_t failures) {
  if (plan == nullptr) return;
  const std::size_t index = static_cast<std::size_t>(call);
  if (index >= plan->rules.size()) return;
  plan->rules[index] = ClipboardApiFaultRule{first_failure_call, failures};
}

void AddCase(std::vector<CaseResult>* results, const char* id, bool passed) {
  if (results == nullptr) return;
  results->push_back(CaseResult{id, passed ? "pass" : "fail",
                                passed ? "api-fault-case-passed"
                                       : "api-fault-case-failed"});
}

void AddNotRun(std::vector<CaseResult>* results,
               const std::vector<const char*>& ids, const char* detail) {
  if (results == nullptr) return;
  for (const char* id : ids) results->push_back(CaseResult{id, "not-run", detail});
}

}  // namespace api_fault_test
}  // namespace clipboard_format_probe
