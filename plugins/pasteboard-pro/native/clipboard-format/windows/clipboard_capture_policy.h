#pragma once

#include "clipboard_probe.h"

#include "../common/clipboard_capture_policy.h"

#include <vector>
#include <string_view>

namespace clipboard_format_probe {

enum class ClipboardOwnerStability {
  unstable,
  owner_observation_stable,
  process_instance_confirmed,
};

struct ClipboardOwnerIdentity {
  HWND window = nullptr;
  DWORD process_id = 0;
  DWORD thread_id = 0;
  FILETIME process_creation_time{};
  bool process_creation_time_known = false;
  bool process_instance_confirmed = false;
  bool owner_observed = false;
  bool identity_known = false;
  bool query_failed = false;
  bool executable_path_query_failed = false;
  bool application_user_model_id_query_failed = false;
  std::wstring executable_path;
  // GetApplicationUserModelId is process/package evidence, not the Shell's
  // explicit per-window System.AppUserModel.ID property.
  std::wstring process_application_user_model_id;
  bool process_application_user_model_id_known = false;
};

struct ClipboardCapturePreflight {
  ClipboardOwnerIdentity owner;
  CapturePolicyReceipt receipt;
};

bool IsWindowsExecutablePathEqual(std::wstring left, std::wstring right);
// Compares process/package AUMIDs, which are case-sensitive identifiers.
bool IsWindowsApplicationUserModelIdEqual(
    std::wstring_view left, std::wstring_view right);

ClipboardCapturePreflight ReadClipboardCapturePolicy(
    const CapturePolicyConfig& policy, HWND observed_owner,
    std::uint32_t expected_revision, const std::vector<UINT>& available_formats,
    bool format_enumeration_complete, UINT monitor_exclusion_format,
    UINT local_history_format, UINT cloud_upload_format);

ClipboardOwnerStability CheckClipboardCaptureOwner(
    const ClipboardOwnerIdentity& owner,
    std::uint32_t expected_revision);

}  // namespace clipboard_format_probe
