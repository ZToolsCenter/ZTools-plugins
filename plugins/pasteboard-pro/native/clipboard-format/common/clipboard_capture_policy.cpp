#include "clipboard_capture_policy.h"

namespace clipboard_format_probe {

CapturePolicyReceipt EvaluateCapturePolicy(
    const CapturePolicyConfig& policy, const CapturePolicyInput& input) {
  CapturePolicyReceipt receipt;
  if (input.source_owner_observed && input.source_stable) {
    receipt.owner_evidence = ClipboardOwnerEvidence::clipboard_owner_window;
  }
  receipt.owner_process_identity_known =
      input.source_identity_known && input.source_process_instance_confirmed;
  receipt.owner_process_instance_confirmed =
      input.source_process_instance_confirmed;
  receipt.process_application_user_model_id_known =
      input.process_application_user_model_id_known;
  receipt.local_history_marker = input.local_history_marker;
  receipt.cloud_marker = input.cloud_marker;
  receipt.monitor_exclusion_present = input.monitor_exclusion_present;
  if (input.content_origin_trusted) {
    receipt.content_origin_trust = ContentOriginTrust::trusted;
  }

  auto deny = [&receipt](CaptureDenial reason) {
    receipt.denial = reason;
    receipt.capture_allowed = false;
    receipt.local_history_permitted = false;
    receipt.cloud_upload_permitted = false;
    return receipt;
  };

  if (policy.paused) return deny(CaptureDenial::paused);
  if (!input.format_enumeration_complete) {
    return deny(CaptureDenial::incomplete_format_enumeration);
  }
  if (!input.source_stable) return deny(CaptureDenial::source_unstable);
  if (input.source_excluded) return deny(CaptureDenial::source_excluded);
  if (!policy.excluded_executable_paths.empty() &&
      (!input.source_owner_observed ||
       !input.source_process_instance_confirmed ||
       !input.executable_identity_known ||
       input.executable_identity_query_failed)) {
    return deny(input.source_owner_observed ? CaptureDenial::source_query_failed
                                           : CaptureDenial::source_unknown);
  }
  if (!policy.excluded_application_user_model_ids.empty()) {
    if (!input.source_owner_observed) {
      return deny(CaptureDenial::source_unknown);
    }
    if (!input.source_process_instance_confirmed) {
      return deny(CaptureDenial::source_query_failed);
    }
    if (input.application_user_model_id_query_failed) {
      return deny(CaptureDenial::source_query_failed);
    }
    if (!input.process_application_user_model_id_known) {
      return deny(CaptureDenial::application_user_model_id_unavailable);
    }
  }

  const bool source_is_unknown =
      !input.source_owner_observed || !input.source_identity_known ||
      !input.source_process_instance_confirmed ||
      input.source_query_failed;
  if (policy.strict_unknown_source && source_is_unknown) {
    return deny(input.source_query_failed
                    ? CaptureDenial::source_query_failed
                    : CaptureDenial::source_unknown);
  }
  if (policy.require_trusted_content_origin &&
      !input.content_origin_trusted) {
    return deny(CaptureDenial::trusted_content_origin_required);
  }
  if (input.monitor_exclusion_present) {
    return deny(CaptureDenial::monitor_excluded);
  }

  if (input.local_history_marker == CaptureMarkerValue::invalid) {
    return deny(CaptureDenial::local_history_marker_invalid);
  }
  if (input.local_history_marker == CaptureMarkerValue::read_failed) {
    return deny(CaptureDenial::local_history_marker_unavailable);
  }
  if (!policy.allow_local_history) {
    return deny(CaptureDenial::local_history_disabled_by_user);
  }
  if (input.local_history_marker == CaptureMarkerValue::request_deny) {
    return deny(CaptureDenial::local_history_disabled_by_marker);
  }

  if (input.cloud_marker == CaptureMarkerValue::invalid ||
      input.cloud_marker == CaptureMarkerValue::read_failed) {
    receipt.cloud_upload = CloudUploadPermission::invalid_marker;
  } else if (input.cloud_marker == CaptureMarkerValue::request_deny) {
    receipt.cloud_upload = CloudUploadPermission::marker_denied;
  } else if (!policy.allow_cloud_upload) {
    receipt.cloud_upload =
        input.cloud_marker == CaptureMarkerValue::request_allow
            ? CloudUploadPermission::request_ignored_by_user
            : CloudUploadPermission::user_disabled;
  } else {
    receipt.cloud_upload = CloudUploadPermission::permitted;
    receipt.cloud_upload_permitted = true;
  }

  receipt.local_history_permitted = true;
  receipt.capture_allowed = true;
  return receipt;
}

const char* CaptureDenialCode(CaptureDenial denial) {
  switch (denial) {
    case CaptureDenial::none: return "none";
    case CaptureDenial::paused: return "capture-paused";
    case CaptureDenial::incomplete_format_enumeration:
      return "format-enumeration-incomplete";
    case CaptureDenial::source_excluded: return "source-excluded";
    case CaptureDenial::source_unknown: return "source-unknown";
    case CaptureDenial::source_query_failed: return "source-query-failed";
    case CaptureDenial::application_user_model_id_unavailable:
      return "process-aumid-unavailable";
    case CaptureDenial::source_unstable: return "source-unstable";
    case CaptureDenial::trusted_content_origin_required:
      return "trusted-content-origin-unavailable";
    case CaptureDenial::monitor_excluded:
      return "monitor-processing-excluded";
    case CaptureDenial::local_history_disabled_by_user:
      return "local-history-disabled-by-user";
    case CaptureDenial::local_history_disabled_by_marker:
      return "local-history-disabled-by-marker";
    case CaptureDenial::local_history_marker_invalid:
      return "local-history-marker-invalid";
    case CaptureDenial::local_history_marker_unavailable:
      return "local-history-marker-unavailable";
  }
  return "capture-policy-denied";
}

const char* CloudUploadPermissionCode(CloudUploadPermission permission) {
  switch (permission) {
    case CloudUploadPermission::user_disabled: return "user-disabled";
    case CloudUploadPermission::marker_denied: return "marker-denied";
    case CloudUploadPermission::permitted: return "permitted";
    case CloudUploadPermission::request_ignored_by_user:
      return "request-ignored-by-user";
    case CloudUploadPermission::invalid_marker: return "invalid-marker";
  }
  return "invalid-marker";
}

}  // namespace clipboard_format_probe
