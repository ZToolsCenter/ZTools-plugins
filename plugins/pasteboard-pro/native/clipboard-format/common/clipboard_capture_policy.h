#pragma once

#include <string>
#include <vector>

namespace clipboard_format_probe {

enum class CaptureMarkerValue {
  absent,
  request_allow,
  request_deny,
  invalid,
  read_failed,
};

enum class CaptureDenial {
  none,
  paused,
  incomplete_format_enumeration,
  source_excluded,
  source_unknown,
  source_query_failed,
  application_user_model_id_unavailable,
  source_unstable,
  trusted_content_origin_required,
  monitor_excluded,
  local_history_disabled_by_user,
  local_history_disabled_by_marker,
  local_history_marker_invalid,
  local_history_marker_unavailable,
};

enum class ClipboardOwnerEvidence {
  unknown,
  clipboard_owner_window,
};

enum class ContentOriginTrust {
  unknown,
  trusted,
};

enum class CloudUploadPermission {
  user_disabled,
  marker_denied,
  permitted,
  request_ignored_by_user,
  invalid_marker,
};

struct CapturePolicyConfig {
  bool paused = false;
  bool strict_unknown_source = false;
  bool require_trusted_content_origin = false;
  bool allow_local_history = true;
  bool allow_cloud_upload = false;
  std::vector<std::wstring> excluded_executable_paths;
  // Only process/package AUMIDs returned by GetApplicationUserModelId are
  // resolved here; explicit Shell per-window IDs are outside this module.
  std::vector<std::wstring> excluded_application_user_model_ids;
};

struct CapturePolicyInput {
  bool format_enumeration_complete = true;
  bool source_owner_observed = false;
  bool source_identity_known = false;
  // Separates stable HWND/PID observations from proof that the PID still names
  // the same process instance across the capture.
  bool source_process_instance_confirmed = false;
  bool executable_identity_known = false;
  bool process_application_user_model_id_known = false;
  bool source_query_failed = false;
  bool executable_identity_query_failed = false;
  bool application_user_model_id_query_failed = false;
  bool source_stable = true;
  bool source_excluded = false;
  bool content_origin_trusted = false;
  bool monitor_exclusion_present = false;
  CaptureMarkerValue local_history_marker = CaptureMarkerValue::absent;
  CaptureMarkerValue cloud_marker = CaptureMarkerValue::absent;
};

struct CapturePolicyReceipt {
  ClipboardOwnerEvidence owner_evidence = ClipboardOwnerEvidence::unknown;
  ContentOriginTrust content_origin_trust = ContentOriginTrust::unknown;
  CaptureDenial denial = CaptureDenial::none;
  CloudUploadPermission cloud_upload = CloudUploadPermission::user_disabled;
  CaptureMarkerValue local_history_marker = CaptureMarkerValue::absent;
  CaptureMarkerValue cloud_marker = CaptureMarkerValue::absent;
  bool owner_process_identity_known = false;
  bool owner_process_instance_confirmed = false;
  bool process_application_user_model_id_known = false;
  bool monitor_exclusion_present = false;
  bool local_history_permitted = false;
  bool cloud_upload_permitted = false;
  bool capture_allowed = false;
};

CapturePolicyReceipt EvaluateCapturePolicy(
    const CapturePolicyConfig& policy, const CapturePolicyInput& input);

const char* CaptureDenialCode(CaptureDenial denial);
const char* CloudUploadPermissionCode(CloudUploadPermission permission);

}  // namespace clipboard_format_probe
