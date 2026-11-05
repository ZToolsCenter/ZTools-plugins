#include "policy_cases.h"

#include "../common/clipboard_capture_policy.h"

#include <cstdio>
#include <string>
#include <utility>
#include <vector>

namespace {

using namespace clipboard_format_probe;

struct TestCase {
  const char* id;
  bool passed;
};

CapturePolicyInput KnownOwnerInput() {
  CapturePolicyInput input;
  input.source_owner_observed = true;
  input.source_identity_known = true;
  input.source_process_instance_confirmed = true;
  input.executable_identity_known = true;
  input.process_application_user_model_id_known = true;
  input.source_stable = true;
  return input;
}

}  // namespace

int RunPolicyCases() {
  using namespace clipboard_format_probe;

  CapturePolicyConfig defaults;
  CapturePolicyInput unknown;
  CapturePolicyReceipt default_result =
      EvaluateCapturePolicy(defaults, unknown);

  CapturePolicyConfig paused = defaults;
  paused.paused = true;

  CapturePolicyConfig strict_unknown = defaults;
  strict_unknown.strict_unknown_source = true;

  CapturePolicyConfig require_trusted = defaults;
  require_trusted.require_trusted_content_origin = true;

  CapturePolicyInput excluded = KnownOwnerInput();
  excluded.source_excluded = true;

  CapturePolicyInput query_failed = KnownOwnerInput();
  query_failed.source_query_failed = true;

  // Simulates GetProcessTimes failing after a path/AUMID lookup could have
  // returned values: those values cannot prove which process instance owned
  // the observed HWND/PID.
  CapturePolicyInput creation_time_unavailable = KnownOwnerInput();
  creation_time_unavailable.source_process_instance_confirmed = false;
  creation_time_unavailable.source_query_failed = true;

  CapturePolicyConfig path_exclusion = defaults;
  path_exclusion.excluded_executable_paths.push_back(L"C:\\secret.exe");
  CapturePolicyInput path_lookup_failed = KnownOwnerInput();
  path_lookup_failed.executable_identity_query_failed = true;
  CapturePolicyInput path_source_unknown;

  CapturePolicyConfig aumid_exclusion = defaults;
  aumid_exclusion.excluded_application_user_model_ids.push_back(
      L"Contoso.Secret!Main");
  CapturePolicyInput aumid_lookup_failed = KnownOwnerInput();
  aumid_lookup_failed.application_user_model_id_query_failed = true;
  CapturePolicyInput aumid_unavailable = KnownOwnerInput();
  aumid_unavailable.process_application_user_model_id_known = false;
  CapturePolicyInput aumid_source_unknown;

  CapturePolicyInput unstable = KnownOwnerInput();
  unstable.source_stable = false;

  CapturePolicyInput incomplete = KnownOwnerInput();
  incomplete.format_enumeration_complete = false;

  CapturePolicyInput monitor_excluded = KnownOwnerInput();
  monitor_excluded.monitor_exclusion_present = true;

  CapturePolicyInput local_opt_out = KnownOwnerInput();
  local_opt_out.local_history_marker = CaptureMarkerValue::request_deny;

  CapturePolicyInput invalid_local = KnownOwnerInput();
  invalid_local.local_history_marker = CaptureMarkerValue::invalid;
  CapturePolicyInput unreadable_local = KnownOwnerInput();
  unreadable_local.local_history_marker = CaptureMarkerValue::read_failed;

  CapturePolicyConfig user_local_disabled = defaults;
  user_local_disabled.allow_local_history = false;
  CapturePolicyInput local_request = KnownOwnerInput();
  local_request.local_history_marker = CaptureMarkerValue::request_allow;

  CapturePolicyInput cloud_opt_out = KnownOwnerInput();
  cloud_opt_out.cloud_marker = CaptureMarkerValue::request_deny;

  CapturePolicyInput cloud_request = KnownOwnerInput();
  cloud_request.cloud_marker = CaptureMarkerValue::request_allow;

  CapturePolicyConfig user_cloud_enabled = defaults;
  user_cloud_enabled.allow_cloud_upload = true;

  CapturePolicyInput invalid_cloud = KnownOwnerInput();
  invalid_cloud.cloud_marker = CaptureMarkerValue::invalid;
  CapturePolicyInput unreadable_cloud = KnownOwnerInput();
  unreadable_cloud.cloud_marker = CaptureMarkerValue::read_failed;

  const auto paused_result = EvaluateCapturePolicy(paused, KnownOwnerInput());
  const auto excluded_result = EvaluateCapturePolicy(defaults, excluded);
  const auto strict_unknown_result =
      EvaluateCapturePolicy(strict_unknown, unknown);
  const auto query_failed_result =
      EvaluateCapturePolicy(strict_unknown, query_failed);
  const auto creation_time_exclusion_result =
      EvaluateCapturePolicy(path_exclusion, creation_time_unavailable);
  const auto creation_time_aumid_exclusion_result =
      EvaluateCapturePolicy(aumid_exclusion, creation_time_unavailable);
  const auto creation_time_strict_result =
      EvaluateCapturePolicy(strict_unknown, creation_time_unavailable);
  const auto creation_time_default_result =
      EvaluateCapturePolicy(defaults, creation_time_unavailable);
  const auto path_lookup_failed_result =
      EvaluateCapturePolicy(path_exclusion, path_lookup_failed);
  const auto path_source_unknown_result =
      EvaluateCapturePolicy(path_exclusion, path_source_unknown);
  const auto aumid_lookup_failed_result =
      EvaluateCapturePolicy(aumid_exclusion, aumid_lookup_failed);
  const auto aumid_unavailable_result =
      EvaluateCapturePolicy(aumid_exclusion, aumid_unavailable);
  const auto aumid_source_unknown_result =
      EvaluateCapturePolicy(aumid_exclusion, aumid_source_unknown);
  const auto unstable_result = EvaluateCapturePolicy(defaults, unstable);
  const auto trusted_result =
      EvaluateCapturePolicy(require_trusted, KnownOwnerInput());
  const auto incomplete_result =
      EvaluateCapturePolicy(defaults, incomplete);
  const auto monitor_result =
      EvaluateCapturePolicy(defaults, monitor_excluded);
  const auto local_opt_out_result =
      EvaluateCapturePolicy(defaults, local_opt_out);
  const auto invalid_local_result =
      EvaluateCapturePolicy(defaults, invalid_local);
  const auto unreadable_local_result =
      EvaluateCapturePolicy(defaults, unreadable_local);
  const auto user_local_result =
      EvaluateCapturePolicy(user_local_disabled, KnownOwnerInput());
  const auto local_request_result =
      EvaluateCapturePolicy(user_local_disabled, local_request);
  const auto cloud_opt_out_result =
      EvaluateCapturePolicy(defaults, cloud_opt_out);
  const auto cloud_request_result =
      EvaluateCapturePolicy(defaults, cloud_request);
  const auto cloud_allowed_result =
      EvaluateCapturePolicy(user_cloud_enabled, cloud_request);
  const auto invalid_cloud_result =
      EvaluateCapturePolicy(defaults, invalid_cloud);
  const auto unreadable_cloud_result =
      EvaluateCapturePolicy(defaults, unreadable_cloud);

  const std::vector<TestCase> cases = {
      {"policy-default-unknown-is-not-trusted",
       default_result.capture_allowed &&
           default_result.owner_evidence == ClipboardOwnerEvidence::unknown &&
           default_result.content_origin_trust == ContentOriginTrust::unknown &&
           !default_result.owner_process_identity_known &&
           default_result.local_history_permitted &&
           !default_result.cloud_upload_permitted},
      {"policy-owner-evidence-is-not-content-origin-trust",
       EvaluateCapturePolicy(defaults, KnownOwnerInput()).capture_allowed &&
           EvaluateCapturePolicy(defaults, KnownOwnerInput()).owner_evidence ==
               ClipboardOwnerEvidence::clipboard_owner_window &&
           EvaluateCapturePolicy(defaults, KnownOwnerInput())
                   .content_origin_trust == ContentOriginTrust::unknown &&
           EvaluateCapturePolicy(defaults, KnownOwnerInput())
                   .owner_process_identity_known},
      {"policy-paused", !paused_result.capture_allowed &&
                            paused_result.denial == CaptureDenial::paused},
      {"policy-source-excluded",
       !excluded_result.capture_allowed &&
           excluded_result.denial == CaptureDenial::source_excluded},
      {"policy-strict-unknown-source",
       !strict_unknown_result.capture_allowed &&
           strict_unknown_result.denial == CaptureDenial::source_unknown},
      {"policy-strict-query-failure",
       !query_failed_result.capture_allowed &&
           query_failed_result.denial == CaptureDenial::source_query_failed},
      {"policy-process-creation-time-failure-blocks-exe-exclusion",
       !creation_time_exclusion_result.capture_allowed &&
           creation_time_exclusion_result.denial ==
               CaptureDenial::source_query_failed},
      {"policy-process-creation-time-failure-blocks-aumid-exclusion",
       !creation_time_aumid_exclusion_result.capture_allowed &&
           creation_time_aumid_exclusion_result.denial ==
               CaptureDenial::source_query_failed},
      {"policy-process-creation-time-failure-blocks-strict-source",
       !creation_time_strict_result.capture_allowed &&
           creation_time_strict_result.denial ==
               CaptureDenial::source_query_failed},
      {"policy-process-creation-time-failure-allows-explicit-unknown",
       creation_time_default_result.capture_allowed &&
           !creation_time_default_result.owner_process_identity_known &&
           !creation_time_default_result.owner_process_instance_confirmed &&
           creation_time_default_result.owner_evidence ==
               ClipboardOwnerEvidence::clipboard_owner_window &&
           creation_time_default_result.content_origin_trust ==
               ContentOriginTrust::unknown},
      {"policy-executable-exclusion-query-failure",
       !path_lookup_failed_result.capture_allowed &&
           path_lookup_failed_result.denial ==
               CaptureDenial::source_query_failed},
      {"policy-executable-exclusion-unknown-source",
       !path_source_unknown_result.capture_allowed &&
           path_source_unknown_result.denial == CaptureDenial::source_unknown},
      {"policy-aumid-exclusion-query-failure",
       !aumid_lookup_failed_result.capture_allowed &&
           aumid_lookup_failed_result.denial ==
               CaptureDenial::source_query_failed},
      {"policy-aumid-exclusion-requires-process-aumid",
       !aumid_unavailable_result.capture_allowed &&
           aumid_unavailable_result.denial ==
               CaptureDenial::application_user_model_id_unavailable},
      {"policy-aumid-exclusion-unknown-source",
       !aumid_source_unknown_result.capture_allowed &&
           aumid_source_unknown_result.denial == CaptureDenial::source_unknown},
      {"policy-unstable-owner", !unstable_result.capture_allowed &&
                                    unstable_result.denial ==
                                        CaptureDenial::source_unstable},
      {"policy-trusted-origin-required",
       !trusted_result.capture_allowed &&
           trusted_result.denial ==
               CaptureDenial::trusted_content_origin_required},
      {"policy-incomplete-enumeration",
       !incomplete_result.capture_allowed &&
           incomplete_result.denial ==
               CaptureDenial::incomplete_format_enumeration},
      {"policy-monitor-exclusion",
       !monitor_result.capture_allowed &&
           monitor_result.denial == CaptureDenial::monitor_excluded},
      {"policy-local-history-marker-zero",
       !local_opt_out_result.capture_allowed &&
           local_opt_out_result.denial ==
               CaptureDenial::local_history_disabled_by_marker},
      {"policy-invalid-history-marker",
       !invalid_local_result.capture_allowed &&
           invalid_local_result.denial ==
               CaptureDenial::local_history_marker_invalid},
      {"policy-unavailable-history-marker",
       !unreadable_local_result.capture_allowed &&
           unreadable_local_result.denial ==
               CaptureDenial::local_history_marker_unavailable},
      {"policy-user-local-history-disabled",
       !user_local_result.capture_allowed &&
           user_local_result.denial ==
               CaptureDenial::local_history_disabled_by_user},
      {"policy-history-marker-one-cannot-override-user",
       !local_request_result.capture_allowed &&
           local_request_result.denial ==
               CaptureDenial::local_history_disabled_by_user},
      {"policy-cloud-marker-zero-keeps-local",
       cloud_opt_out_result.capture_allowed &&
           cloud_opt_out_result.local_history_permitted &&
           !cloud_opt_out_result.cloud_upload_permitted &&
           cloud_opt_out_result.cloud_upload ==
               CloudUploadPermission::marker_denied &&
           cloud_opt_out_result.cloud_marker ==
               CaptureMarkerValue::request_deny},
      {"policy-cloud-marker-one-cannot-override-user",
       cloud_request_result.capture_allowed &&
           !cloud_request_result.cloud_upload_permitted &&
           cloud_request_result.cloud_upload ==
               CloudUploadPermission::request_ignored_by_user},
      {"policy-cloud-marker-one-with-user-allow",
       cloud_allowed_result.capture_allowed &&
           cloud_allowed_result.cloud_upload_permitted &&
           cloud_allowed_result.cloud_upload ==
               CloudUploadPermission::permitted},
      {"policy-invalid-cloud-marker-keeps-local",
       invalid_cloud_result.capture_allowed &&
           invalid_cloud_result.local_history_permitted &&
           !invalid_cloud_result.cloud_upload_permitted &&
           invalid_cloud_result.cloud_upload ==
               CloudUploadPermission::invalid_marker},
      {"policy-unavailable-cloud-marker-keeps-local",
       unreadable_cloud_result.capture_allowed &&
           unreadable_cloud_result.local_history_permitted &&
           !unreadable_cloud_result.cloud_upload_permitted &&
           unreadable_cloud_result.cloud_upload ==
               CloudUploadPermission::invalid_marker},
  };

  int failures = 0;
  for (const auto& test : cases) {
    std::printf("%s %s\n", test.passed ? "PASS" : "FAIL", test.id);
    if (!test.passed) ++failures;
  }
  return failures == 0 ? 0 : 1;
}
