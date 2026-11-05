#include "clipboard_api_fault_tests.h"

#include "clipboard_api_fault_test_support.h"

#include <array>
#include <vector>

namespace clipboard_format_probe {
namespace {

using api_fault_test::AddCase;
using api_fault_test::AddNotRun;
using api_fault_test::ConfigureFailure;
using api_fault_test::CountsEqual;
using api_fault_test::HookScope;
using api_fault_test::IsPrivateProbeStation;
using api_fault_test::ReadClipboardSnapshot;
using api_fault_test::SeedAndCaptureBaseline;
using api_fault_test::HasExactPayload;

constexpr std::array<const char*, 3> kCaseIds = {
    "api-capture-open-exhaustion-resets-output",
    "api-capture-close-failure-discards-output",
    "api-capture-close-failure-after-policy-denial",
};

bool OutputWasReset(const ClipboardSnapshot& output) {
  return output.formats.empty() && output.missing_keys.empty() &&
         output.revision_before_open == 0 &&
         output.revision_after_materialization == 0 &&
         output.owner_process_id == 0;
}

bool BaselineStillPresent(Win32ClipboardAdapter* adapter,
                          const ClipboardSnapshot& baseline,
                          const FormatPayload& baseline_text) {
  ClipboardSnapshot current;
  return ReadClipboardSnapshot(adapter, &current) &&
         adapter->Revision() == baseline.revision_after_materialization &&
         current.revision_after_materialization ==
             baseline.revision_after_materialization &&
         HasExactPayload(current, baseline_text);
}

}  // namespace

std::vector<CaseResult> RunApiCaptureFaultCases(
    Win32ClipboardAdapter* adapter) {
  std::vector<CaseResult> results;
  const std::vector<const char*> ids(kCaseIds.begin(), kCaseIds.end());
  if (adapter == nullptr || !adapter->IsInitialized()) {
    AddNotRun(&results, ids, "adapter-unavailable");
    return results;
  }
  if (!IsPrivateProbeStation(adapter)) {
    AddNotRun(&results, ids, "private-station-required");
    return results;
  }

  ClipboardApiFaultPlan faults;
  HookScope hooks(adapter);

  // Open exhaustion returns busy, clears prior output, and preserves clipboard data.
  {
    ClipboardApiFaultTestAccess::ClearHooks(adapter);
    ClipboardSnapshot baseline;
    FormatPayload baseline_text;
    const bool seeded = SeedAndCaptureBaseline(adapter, &baseline,
                                               &baseline_text);
    faults = ClipboardApiFaultPlan{};
    ConfigureFailure(&faults, ClipboardApiCall::open, 1, 5);
    hooks.SetFaults(&faults);

    ClipboardSnapshot output;
    output.revision_before_open = 7;
    output.revision_after_materialization = 8;
    output.owner_process_id = 9;
    output.formats.push_back(FormatPayload{"sentinel", L"sentinel", 0, {1}});
    output.missing_keys.push_back("stale-output");
    const OperationResult result = adapter->Capture(adapter->Revision(), &output);
    const bool api_calls =
        CountsEqual(faults, ClipboardApiCall::open, 5, 0) &&
        CountsEqual(faults, ClipboardApiCall::empty, 0, 0) &&
        CountsEqual(faults, ClipboardApiCall::set, 0, 0) &&
        CountsEqual(faults, ClipboardApiCall::close, 0, 0);
    hooks.DisableFaults();
    AddCase(&results, kCaseIds[0], seeded && api_calls &&
        result.status == OperationStatus::clipboard_busy &&
        OutputWasReset(output) &&
        adapter->Revision() == baseline.revision_after_materialization &&
        BaselineStillPresent(adapter, baseline, baseline_text));
  }

  // A failed explicit close discards a fully materialized capture result.
  {
    ClipboardSnapshot baseline;
    FormatPayload baseline_text;
    const bool seeded = SeedAndCaptureBaseline(adapter, &baseline,
                                               &baseline_text);
    faults = ClipboardApiFaultPlan{};
    ConfigureFailure(&faults, ClipboardApiCall::close);
    hooks.SetFaults(&faults);

    ClipboardSnapshot output;
    output.formats.push_back(FormatPayload{"sentinel", L"sentinel", 0, {1}});
    const OperationResult result = adapter->Capture(adapter->Revision(), &output);
    const bool api_calls =
        CountsEqual(faults, ClipboardApiCall::open, 1, 1) &&
        CountsEqual(faults, ClipboardApiCall::empty, 0, 0) &&
        CountsEqual(faults, ClipboardApiCall::set, 0, 0) &&
        CountsEqual(faults, ClipboardApiCall::close, 2, 1);
    hooks.DisableFaults();
    AddCase(&results, kCaseIds[1], seeded && api_calls &&
        result.status == OperationStatus::read_failed &&
        result.reason == "CloseClipboard failed after capture" &&
        OutputWasReset(output) &&
        adapter->Revision() == baseline.revision_after_materialization &&
        BaselineStillPresent(adapter, baseline, baseline_text));
  }

  // Policy denial is withheld until Close succeeds; a close failure is read_failed.
  {
    ClipboardSnapshot baseline;
    FormatPayload baseline_text;
    const bool seeded = SeedAndCaptureBaseline(adapter, &baseline,
                                               &baseline_text);
    const CapturePolicyConfig original_policy = adapter->CapturePolicyOptions();
    CapturePolicyConfig denying_policy = original_policy;
    denying_policy.require_trusted_content_origin = true;
    adapter->SetCapturePolicy(denying_policy);

    std::size_t ordinary_reader_calls = 0;
    hooks.SetOrdinaryReader([&ordinary_reader_calls](UINT format) {
      ++ordinary_reader_calls;
      return ::GetClipboardData(format);
    });
    faults = ClipboardApiFaultPlan{};
    ConfigureFailure(&faults, ClipboardApiCall::close);
    hooks.SetFaults(&faults);

    ClipboardSnapshot output;
    output.formats.push_back(FormatPayload{"sentinel", L"sentinel", 0, {1}});
    const OperationResult result = adapter->Capture(adapter->Revision(), &output);
    const bool api_calls =
        CountsEqual(faults, ClipboardApiCall::open, 1, 1) &&
        CountsEqual(faults, ClipboardApiCall::empty, 0, 0) &&
        CountsEqual(faults, ClipboardApiCall::set, 0, 0) &&
        CountsEqual(faults, ClipboardApiCall::close, 2, 1);
    hooks.DisableFaults();
    hooks.SetOrdinaryReader({});
    adapter->SetCapturePolicy(original_policy);
    AddCase(&results, kCaseIds[2], seeded && api_calls &&
        result.status == OperationStatus::read_failed &&
        result.reason == "CloseClipboard failed after capture policy preflight" &&
        ordinary_reader_calls == 0 && OutputWasReset(output) &&
        adapter->Revision() == baseline.revision_after_materialization &&
        BaselineStillPresent(adapter, baseline, baseline_text));
  }

  return results;
}

}  // namespace clipboard_format_probe
