#include "clipboard_capture_policy.h"

#include <appmodel.h>

#include <algorithm>
#include <cstring>
#include <limits>
#include <string_view>
#include <vector>
#include <functional>
#include <utility>

namespace clipboard_format_probe {
namespace {

constexpr std::size_t kMaximumMarkerAllocationBytes = 64;
constexpr UINT32 kMaximumApplicationUserModelIdCharacters = 512;

bool HasFormat(const std::vector<UINT>& formats, UINT target) {
  return target != 0 &&
         std::find(formats.begin(), formats.end(), target) != formats.end();
}

CaptureMarkerValue ReadDwordMarker(UINT format) {
  // GetClipboardData can synchronously trigger delayed rendering. A supervised
  // helper process is the cancellation boundary for that OS call.
  HANDLE handle = GetClipboardData(format);
  if (handle == nullptr) return CaptureMarkerValue::read_failed;

  const SIZE_T size = GlobalSize(handle);
  if (size < sizeof(DWORD) || size > kMaximumMarkerAllocationBytes) {
    return CaptureMarkerValue::invalid;
  }
  const auto* bytes = static_cast<const std::uint8_t*>(GlobalLock(handle));
  if (bytes == nullptr) return CaptureMarkerValue::read_failed;

  DWORD value = std::numeric_limits<DWORD>::max();
  std::memcpy(&value, bytes, sizeof(value));
  SetLastError(ERROR_SUCCESS);
  const BOOL unlocked = GlobalUnlock(handle);
  const DWORD unlock_error = GetLastError();
  if (!unlocked && unlock_error != ERROR_SUCCESS) {
    return CaptureMarkerValue::read_failed;
  }
  if (value == 0) return CaptureMarkerValue::request_deny;
  if (value == 1) return CaptureMarkerValue::request_allow;
  return CaptureMarkerValue::invalid;
}

enum class ApplicationUserModelIdQuery { found, no_application, failed };

ApplicationUserModelIdQuery QueryApplicationUserModelId(
    HANDLE process, std::wstring* value) {
  UINT32 length = 0;
  const LONG first = GetApplicationUserModelId(process, &length, nullptr);
  if (first == APPMODEL_ERROR_NO_APPLICATION) {
    return ApplicationUserModelIdQuery::no_application;
  }
  if (first != ERROR_INSUFFICIENT_BUFFER || length == 0 ||
      length > kMaximumApplicationUserModelIdCharacters) {
    return ApplicationUserModelIdQuery::failed;
  }

  std::vector<wchar_t> buffer(length, L'\0');
  UINT32 capacity = length;
  if (GetApplicationUserModelId(process, &capacity, buffer.data()) !=
          ERROR_SUCCESS ||
      capacity == 0 || capacity > buffer.size() ||
      buffer[capacity - 1] != L'\0') {
    return ApplicationUserModelIdQuery::failed;
  }
  value->assign(buffer.data(), capacity - 1);
  return value->empty() ? ApplicationUserModelIdQuery::failed
                        : ApplicationUserModelIdQuery::found;
}

bool QueryOwnerIdentity(HWND window, ClipboardOwnerIdentity* owner) {
  owner->window = window;
  owner->owner_observed = window != nullptr;
  if (window == nullptr) return true;

  owner->thread_id = GetWindowThreadProcessId(window, &owner->process_id);
  if (owner->thread_id == 0 || owner->process_id == 0 ||
      !IsWindow(window)) {
    owner->query_failed = true;
    owner->executable_path_query_failed = true;
    owner->application_user_model_id_query_failed = true;
    return false;
  }

  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE,
                               owner->process_id);
  if (process == nullptr) {
    owner->query_failed = true;
    owner->executable_path_query_failed = true;
    owner->application_user_model_id_query_failed = true;
    return false;
  }

  FILETIME exit_time{};
  FILETIME kernel_time{};
  FILETIME user_time{};
  if (GetProcessTimes(process, &owner->process_creation_time, &exit_time,
                      &kernel_time, &user_time)) {
    owner->process_creation_time_known = true;
  } else {
    owner->query_failed = true;
    owner->executable_path_query_failed = true;
    owner->application_user_model_id_query_failed = true;
    CloseHandle(process);
    return false;
  }

  std::vector<wchar_t> path(32768, L'\0');
  DWORD path_length = static_cast<DWORD>(path.size());
  if (QueryFullProcessImageNameW(process, 0, path.data(), &path_length) &&
      path_length > 0 && path_length <= path.size()) {
    owner->executable_path.assign(path.data(), path_length);
  } else {
    owner->executable_path_query_failed = true;
  }

  const auto aumid_result = QueryApplicationUserModelId(
      process, &owner->process_application_user_model_id);
  owner->process_application_user_model_id_known =
      aumid_result == ApplicationUserModelIdQuery::found;
  owner->application_user_model_id_query_failed =
      aumid_result == ApplicationUserModelIdQuery::failed;
  CloseHandle(process);

  owner->identity_known = owner->process_creation_time_known &&
                          (!owner->executable_path.empty() ||
                           owner->process_application_user_model_id_known);
  owner->query_failed = !owner->identity_known;
  return owner->identity_known;
}

bool IsExcluded(const CapturePolicyConfig& policy,
                const ClipboardOwnerIdentity& owner) {
  if (!owner.process_instance_confirmed || !owner.identity_known) return false;
  for (const auto& excluded : policy.excluded_executable_paths) {
    if (IsWindowsExecutablePathEqual(owner.executable_path, excluded)) {
      return true;
    }
  }
  for (const auto& excluded :
       policy.excluded_application_user_model_ids) {
    if (IsWindowsApplicationUserModelIdEqual(
            owner.process_application_user_model_id, excluded)) {
      return true;
    }
  }
  return false;
}

CapturePolicyInput MakePolicyInput(
    const CapturePolicyConfig& policy, const ClipboardOwnerIdentity& owner,
    bool enumeration_complete) {
  CapturePolicyInput input;
  input.format_enumeration_complete = enumeration_complete;
  input.source_owner_observed = owner.owner_observed;
  input.source_process_instance_confirmed =
      owner.process_instance_confirmed;
  input.source_identity_known =
      owner.identity_known && owner.process_instance_confirmed;
  input.executable_identity_known =
      !owner.executable_path.empty() && owner.process_instance_confirmed;
  input.process_application_user_model_id_known =
      owner.process_application_user_model_id_known &&
      owner.process_instance_confirmed;
  input.source_query_failed = owner.query_failed;
  input.executable_identity_query_failed =
      owner.executable_path_query_failed;
  input.application_user_model_id_query_failed =
      owner.application_user_model_id_query_failed;
  input.source_excluded = IsExcluded(policy, owner);
  return input;
}

CapturePolicyReceipt DenyIfUnstable(
    const CapturePolicyConfig& policy, CapturePolicyInput input) {
  input.source_stable = false;
  return EvaluateCapturePolicy(policy, input);
}

bool CompareOrdinal(std::wstring_view left, std::wstring_view right,
                    bool ignore_case) {
  if (left.empty() || right.empty() ||
      left.size() > static_cast<std::size_t>(std::numeric_limits<int>::max()) ||
      right.size() >
          static_cast<std::size_t>(std::numeric_limits<int>::max())) {
    return false;
  }
  return CompareStringOrdinal(left.data(), static_cast<int>(left.size()),
                              right.data(), static_cast<int>(right.size()),
                              ignore_case ? TRUE : FALSE) == CSTR_EQUAL;
}

bool SameCreationTime(const FILETIME& left, const FILETIME& right) {
  return left.dwLowDateTime == right.dwLowDateTime &&
         left.dwHighDateTime == right.dwHighDateTime;
}

}  // namespace

bool IsWindowsExecutablePathEqual(std::wstring left, std::wstring right) {
  std::replace(left.begin(), left.end(), L'/', L'\\');
  std::replace(right.begin(), right.end(), L'/', L'\\');
  return CompareOrdinal(left, right, true);
}

bool IsWindowsApplicationUserModelIdEqual(
    std::wstring_view left, std::wstring_view right) {
  return CompareOrdinal(left, right, false);
}

ClipboardCapturePreflight ReadClipboardCapturePolicy(
    const CapturePolicyConfig& policy, HWND observed_owner,
    std::uint32_t expected_revision, const std::vector<UINT>& available_formats,
    bool format_enumeration_complete, UINT monitor_exclusion_format,
    UINT local_history_format, UINT cloud_upload_format) {
  ClipboardCapturePreflight preflight;
  QueryOwnerIdentity(observed_owner, &preflight.owner);
  const auto initial_stability =
      CheckClipboardCaptureOwner(preflight.owner, expected_revision);
  preflight.owner.process_instance_confirmed =
      initial_stability == ClipboardOwnerStability::process_instance_confirmed;
  auto input = MakePolicyInput(policy, preflight.owner,
                               format_enumeration_complete);
  input.source_stable =
      initial_stability != ClipboardOwnerStability::unstable;
  if (!input.source_stable) {
    preflight.receipt = DenyIfUnstable(policy, input);
    return preflight;
  }
  preflight.receipt = EvaluateCapturePolicy(policy, input);
  if (!preflight.receipt.capture_allowed) return preflight;

  if (HasFormat(available_formats, monitor_exclusion_format)) {
    input.monitor_exclusion_present = true;
    preflight.receipt = EvaluateCapturePolicy(policy, input);
    return preflight;
  }

  if (HasFormat(available_formats, local_history_format)) {
    input.local_history_marker = ReadDwordMarker(local_history_format);
    preflight.receipt = EvaluateCapturePolicy(policy, input);
    if (!preflight.receipt.capture_allowed) return preflight;
  }

  if (HasFormat(available_formats, cloud_upload_format)) {
    input.cloud_marker = ReadDwordMarker(cloud_upload_format);
  }

  if (CheckClipboardCaptureOwner(preflight.owner, expected_revision) ==
      ClipboardOwnerStability::unstable) {
    preflight.receipt = DenyIfUnstable(policy, input);
    return preflight;
  }
  preflight.receipt = EvaluateCapturePolicy(policy, input);
  return preflight;
}

void Win32ClipboardAdapter::SetCapturePolicy(CapturePolicyConfig policy) {
  capture_policy_ = std::move(policy);
}

HANDLE Win32ClipboardAdapter::ReadOrdinaryClipboardData(UINT format) {
  if (ordinary_reader_for_testing_) {
    return ordinary_reader_for_testing_(format);
  }
  return GetClipboardData(format);
}

ClipboardCapturePreflight Win32ClipboardAdapter::PreflightCapture(
    HWND owner, std::uint32_t revision, const std::vector<UINT>& formats,
    bool enumeration_complete) const {
  return ReadClipboardCapturePolicy(
      capture_policy_, owner, revision, formats, enumeration_complete,
      monitor_exclusion_id_, local_history_marker_id_,
      cloud_upload_marker_id_);
}

ClipboardOwnerStability CheckClipboardCaptureOwner(
    const ClipboardOwnerIdentity& owner,
    std::uint32_t expected_revision) {
  if (GetClipboardSequenceNumber() != expected_revision ||
      GetClipboardOwner() != owner.window) {
    return ClipboardOwnerStability::unstable;
  }
  if (!owner.owner_observed) {
    return owner.window == nullptr
               ? ClipboardOwnerStability::owner_observation_stable
               : ClipboardOwnerStability::unstable;
  }

  DWORD process_id = 0;
  const DWORD thread_id =
      GetWindowThreadProcessId(owner.window, &process_id);
  if (!IsWindow(owner.window) || process_id != owner.process_id ||
      thread_id != owner.thread_id || process_id == 0 || thread_id == 0) {
    return ClipboardOwnerStability::unstable;
  }

  if (!owner.process_creation_time_known) {
    return ClipboardOwnerStability::owner_observation_stable;
  }
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE,
                               owner.process_id);
  if (process == nullptr) return ClipboardOwnerStability::unstable;
  FILETIME creation_time{};
  FILETIME exit_time{};
  FILETIME kernel_time{};
  FILETIME user_time{};
  DWORD exit_code = 0;
  const bool stable =
      GetProcessTimes(process, &creation_time, &exit_time, &kernel_time,
                      &user_time) &&
      SameCreationTime(creation_time, owner.process_creation_time) &&
      GetExitCodeProcess(process, &exit_code) && exit_code == STILL_ACTIVE;
  CloseHandle(process);
  return stable ? ClipboardOwnerStability::process_instance_confirmed
                : ClipboardOwnerStability::unstable;
}

}  // namespace clipboard_format_probe
