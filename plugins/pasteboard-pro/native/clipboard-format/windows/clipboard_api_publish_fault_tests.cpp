#include "clipboard_api_fault_tests.h"

#include "clipboard_api_fault_test_support.h"
#include "clipboard_format_equivalence.h"
#include "clipboard_self_test_fixtures.h"

#include <algorithm>
#include <iterator>
#include <string>
#include <vector>

namespace clipboard_format_probe {
namespace {

using api_fault_test::AddCase;
using api_fault_test::AddNotRun;
using api_fault_test::ConfigureFailure;
using api_fault_test::CountsEqual;
using api_fault_test::HookScope;
using api_fault_test::IsPrivateProbeStation;
using api_fault_test::KeysAfter;
using api_fault_test::KeysThrough;
using api_fault_test::MakeThreeGlobalFormatPlan;
using api_fault_test::ReadClipboardSnapshot;
using api_fault_test::ReleaseLedger;
using api_fault_test::SeedAndCaptureBaseline;
using api_fault_test::SameKeys;

constexpr const char* kCaseIds[] = {
    "api-open-exhaustion-preserves-clipboard",
    "api-empty-failure-preserves-clipboard",
    "api-set-first-failure-cleans-untransferred",
    "api-set-middle-failure-keeps-partial-prefix",
    "api-set-last-failure-reports-missing-tail",
    "api-set-gdi-bitmap-failure-releases-object",
    "api-set-palette-failure-keeps-bitmap-owner",
    "api-close-failure-after-full-write-is-unconfirmed",
    "api-close-failure-after-partial-write-cleans-rest",
    "api-close-persistent-failure-never-commits",
    "api-empty-and-close-failure-keeps-baseline",
    "api-fault-hooks-reset-and-recover",
};

bool BaselineUnchanged(Win32ClipboardAdapter* adapter,
                       const ClipboardSnapshot& baseline,
                       const FormatPayload& expected_text) {
  ClipboardSnapshot current;
  return ReadClipboardSnapshot(adapter, &current) &&
         current.revision_after_materialization ==
             baseline.revision_after_materialization &&
         adapter->Revision() == baseline.revision_after_materialization &&
         api_fault_test::HasExactPayload(current, expected_text);
}

void InstallCaseHooks(HookScope* hooks, ClipboardApiFaultPlan* faults,
                      ReleaseLedger* ledger) {
  *faults = ClipboardApiFaultPlan{};
  *ledger = ReleaseLedger{};
  hooks->SetFaults(faults);
  hooks->SetObserver([ledger](PreparedFormat& format) {
    ledger->Attach(format);
  });
}

bool VerifyFaultedPrefix(Win32ClipboardAdapter* adapter,
                         ClipboardApiFaultPlan* faults,
                         const std::vector<FormatPayload>& plan,
                         std::size_t prefix_length,
                         const ReleaseLedger& ledger,
                         const OperationResult& result,
                         bool close_fault = false) {
  const auto planned = KeysThrough(plan, plan.size());
  const auto written = KeysThrough(plan, prefix_length);
  const auto missing = KeysAfter(plan, prefix_length);
  const bool result_is_exact =
      result.status == OperationStatus::partial_write &&
      result.clipboard_may_have_changed &&
      SameKeys(result.planned_keys, planned) &&
      SameKeys(result.written_keys, written) &&
      SameKeys(result.missing_keys, missing);
  const bool releases_exact = ledger.IsExactFor(plan, written);

  // Disable the injected boundary before observing the private clipboard.
  ClipboardApiFaultTestAccess::SetFaults(adapter, nullptr);
  ClipboardSnapshot readback;
  const bool readback_ok = ReadClipboardSnapshot(adapter, &readback) &&
      (prefix_length == 0
           ? api_fault_test::HasNoPlannedPayload(readback, plan)
           : api_fault_test::HasExactPrefix(readback, plan, prefix_length));
  const bool close_counts = close_fault
      ? CountsEqual(*faults, ClipboardApiCall::close, 2, 1)
      : CountsEqual(*faults, ClipboardApiCall::close, 1, 1);
  return result_is_exact && releases_exact && readback_ok && close_counts;
}

bool HasCapturedBitmap(const ClipboardSnapshot& snapshot,
                        const FormatPayload& expected) {
  const auto found = std::find_if(
      snapshot.formats.begin(), snapshot.formats.end(),
      [](const FormatPayload& format) { return format.key == "bitmap"; });
  if (found == snapshot.formats.end()) return false;
  const auto comparison = CompareFormatRepresentations(
      expected, *found, FormatComparisonMode::allow_visible_bitmap_rgb);
  return comparison == FormatComparison::exact ||
         comparison == FormatComparison::compatible;
}

}  // namespace

std::vector<CaseResult> RunApiPublishFaultCases(
    Win32ClipboardAdapter* adapter) {
  std::vector<CaseResult> results;
  const std::vector<const char*> ids(std::begin(kCaseIds), std::end(kCaseIds));
  if (adapter == nullptr || !adapter->IsInitialized()) {
    AddNotRun(&results, ids, "adapter-unavailable");
    return results;
  }
  if (!IsPrivateProbeStation(adapter)) {
    AddNotRun(&results, ids, "private-station-required");
    return results;
  }

  const UINT html_id = RegisterClipboardFormatW(L"HTML Format");
  const UINT rtf_id = RegisterClipboardFormatW(L"Rich Text Format");
  const auto plan = MakeThreeGlobalFormatPlan(html_id, rtf_id);
  if (plan.size() != 3) {
    AddNotRun(&results, ids, "format-registration-failed");
    return results;
  }

  ClipboardApiFaultPlan faults;
  ReleaseLedger ledger;
  HookScope hooks(adapter);

  // 1. Open exhaustion must not clear or alter the baseline clipboard.
  {
    ClipboardSnapshot baseline;
    FormatPayload baseline_text;
    const bool seeded = SeedAndCaptureBaseline(adapter, &baseline,
                                               &baseline_text);
    InstallCaseHooks(&hooks, &faults, &ledger);
    ConfigureFailure(&faults, ClipboardApiCall::open, 1, 5);
    const OperationResult result =
        adapter->Publish(adapter->Revision(), plan);
    const bool counts = CountsEqual(faults, ClipboardApiCall::open, 5, 0) &&
        CountsEqual(faults, ClipboardApiCall::empty, 0, 0) &&
        CountsEqual(faults, ClipboardApiCall::set, 0, 0) &&
        CountsEqual(faults, ClipboardApiCall::close, 0, 0);
    hooks.DisableFaults();
    AddCase(&results, kCaseIds[0], seeded &&
        result.status == OperationStatus::clipboard_busy &&
        !result.clipboard_may_have_changed &&
        SameKeys(result.planned_keys, KeysThrough(plan, plan.size())) &&
        result.written_keys.empty() && result.missing_keys.empty() && counts &&
        ledger.IsExactFor(plan, {}) &&
        BaselineUnchanged(adapter, baseline, baseline_text));
  }

  // 2. Empty failure is injected before the native call; baseline survives.
  {
    ClipboardSnapshot baseline;
    FormatPayload baseline_text;
    const bool seeded = SeedAndCaptureBaseline(adapter, &baseline,
                                               &baseline_text);
    InstallCaseHooks(&hooks, &faults, &ledger);
    ConfigureFailure(&faults, ClipboardApiCall::empty);
    const OperationResult result =
        adapter->Publish(adapter->Revision(), plan);
    const bool counts = CountsEqual(faults, ClipboardApiCall::open, 1, 1) &&
        CountsEqual(faults, ClipboardApiCall::empty, 1, 0) &&
        CountsEqual(faults, ClipboardApiCall::set, 0, 0) &&
        CountsEqual(faults, ClipboardApiCall::close, 1, 1);
    hooks.DisableFaults();
    AddCase(&results, kCaseIds[1], seeded &&
        result.status == OperationStatus::write_failed &&
        !result.clipboard_may_have_changed && result.written_keys.empty() &&
        result.missing_keys.empty() && counts && ledger.IsExactFor(plan, {}) &&
        BaselineUnchanged(adapter, baseline, baseline_text));
  }

  // 3–5. API Set failures cover the first, middle, and final planned item.
  for (std::size_t failure_index = 0; failure_index < 3; ++failure_index) {
    ClipboardSnapshot baseline;
    FormatPayload baseline_text;
    const bool seeded = SeedAndCaptureBaseline(adapter, &baseline,
                                               &baseline_text);
    InstallCaseHooks(&hooks, &faults, &ledger);
    ConfigureFailure(&faults, ClipboardApiCall::set, failure_index + 1);
    const OperationResult result =
        adapter->Publish(adapter->Revision(), plan);
    const auto written = KeysThrough(plan, failure_index);
    const bool calls = CountsEqual(faults, ClipboardApiCall::open, 1, 1) &&
        CountsEqual(faults, ClipboardApiCall::empty, 1, 1) &&
        CountsEqual(faults, ClipboardApiCall::set, failure_index + 1,
                    failure_index) &&
        CountsEqual(faults, ClipboardApiCall::close, 1, 1);
    const bool exact = VerifyFaultedPrefix(adapter, &faults, plan,
                                           failure_index, ledger, result);
    AddCase(&results, kCaseIds[2 + failure_index],
            seeded && calls && exact &&
                result.reason == "SetClipboardData failed");
  }

  // 6. A failed bitmap SetClipboardData releases the still-owned GDI object.
  {
    auto bitmap_plan = std::vector<FormatPayload>{
        test_fixtures::MakeText(CF_UNICODETEXT),
        test_fixtures::MakeBitmap(CF_BITMAP)};
    ClipboardSnapshot baseline;
    FormatPayload baseline_text;
    const bool seeded = SeedAndCaptureBaseline(adapter, &baseline,
                                               &baseline_text);
    InstallCaseHooks(&hooks, &faults, &ledger);
    ConfigureFailure(&faults, ClipboardApiCall::set, 2);
    const OperationResult result =
        adapter->Publish(adapter->Revision(), bitmap_plan);
    const bool calls =
        CountsEqual(faults, ClipboardApiCall::open, 1, 1) &&
        CountsEqual(faults, ClipboardApiCall::empty, 1, 1) &&
        CountsEqual(faults, ClipboardApiCall::set, 2, 1) &&
        CountsEqual(faults, ClipboardApiCall::close, 1, 1);
    const bool exact = VerifyFaultedPrefix(adapter, &faults, bitmap_plan, 1,
                                           ledger, result);
    AddCase(&results, kCaseIds[5], seeded && calls && exact &&
        ledger.IsExactFor(bitmap_plan, KeysThrough(bitmap_plan, 1)));
  }

  // 7. A palette failure cannot revoke ownership already transferred for a bitmap.
  {
    auto bitmap_palette_plan = std::vector<FormatPayload>{
        test_fixtures::MakeBitmap(CF_BITMAP), test_fixtures::MakePalette()};
    ClipboardSnapshot baseline;
    FormatPayload baseline_text;
    const bool seeded = SeedAndCaptureBaseline(adapter, &baseline,
                                               &baseline_text);
    InstallCaseHooks(&hooks, &faults, &ledger);
    ConfigureFailure(&faults, ClipboardApiCall::set, 2);
    const OperationResult result =
        adapter->Publish(adapter->Revision(), bitmap_palette_plan);
    const bool counts = CountsEqual(faults, ClipboardApiCall::open, 1, 1) &&
        CountsEqual(faults, ClipboardApiCall::empty, 1, 1) &&
        CountsEqual(faults, ClipboardApiCall::set, 2, 1) &&
        CountsEqual(faults, ClipboardApiCall::close, 1, 1);
    hooks.DisableFaults();
    ClipboardSnapshot readback;
    const bool retained_bitmap = ReadClipboardSnapshot(adapter, &readback) &&
                                 HasCapturedBitmap(readback, bitmap_palette_plan.front());
    AddCase(&results, kCaseIds[6], seeded && counts && retained_bitmap &&
        result.status == OperationStatus::partial_write &&
        result.clipboard_may_have_changed &&
        SameKeys(result.planned_keys, KeysThrough(bitmap_palette_plan, 2)) &&
        SameKeys(result.written_keys, KeysThrough(bitmap_palette_plan, 1)) &&
        SameKeys(result.missing_keys, KeysAfter(bitmap_palette_plan, 1)) &&
        ledger.IsExactFor(bitmap_palette_plan,
                          KeysThrough(bitmap_palette_plan, 1)));
  }

  // 8. Full writes followed by one failed Close remain explicitly unconfirmed.
  {
    ClipboardSnapshot baseline;
    FormatPayload baseline_text;
    const bool seeded = SeedAndCaptureBaseline(adapter, &baseline,
                                               &baseline_text);
    InstallCaseHooks(&hooks, &faults, &ledger);
    ConfigureFailure(&faults, ClipboardApiCall::close);
    const OperationResult result =
        adapter->Publish(adapter->Revision(), plan);
    const bool counts = CountsEqual(faults, ClipboardApiCall::open, 1, 1) &&
        CountsEqual(faults, ClipboardApiCall::empty, 1, 1) &&
        CountsEqual(faults, ClipboardApiCall::set, 3, 3) &&
        CountsEqual(faults, ClipboardApiCall::close, 2, 1);
    hooks.DisableFaults();
    ClipboardSnapshot readback;
    const bool retained = ReadClipboardSnapshot(adapter, &readback) &&
        api_fault_test::HasExactPrefix(readback, plan, plan.size());
    AddCase(&results, kCaseIds[7], seeded && counts && retained &&
        result.status == OperationStatus::partial_write &&
        result.reason == "publication-unconfirmed" &&
        result.clipboard_may_have_changed && result.write_revision.has_value() &&
        SameKeys(result.written_keys, KeysThrough(plan, plan.size())) &&
        result.missing_keys.empty() &&
        ledger.IsExactFor(plan, KeysThrough(plan, plan.size())));
  }

  // 9. A partial Set plus a one-shot Close failure retains only the real prefix.
  {
    ClipboardSnapshot baseline;
    FormatPayload baseline_text;
    const bool seeded = SeedAndCaptureBaseline(adapter, &baseline,
                                               &baseline_text);
    InstallCaseHooks(&hooks, &faults, &ledger);
    ConfigureFailure(&faults, ClipboardApiCall::set, 2);
    ConfigureFailure(&faults, ClipboardApiCall::close);
    const OperationResult result =
        adapter->Publish(adapter->Revision(), plan);
    const bool calls =
        CountsEqual(faults, ClipboardApiCall::open, 1, 1) &&
        CountsEqual(faults, ClipboardApiCall::empty, 1, 1) &&
        CountsEqual(faults, ClipboardApiCall::set, 2, 1);
    const bool exact = VerifyFaultedPrefix(adapter, &faults, plan, 1, ledger,
                                           result, true);
    AddCase(&results, kCaseIds[8], seeded && calls && exact &&
        result.reason == "CloseClipboard failed after publication was attempted");
  }

  // 10. Persistent Close failure is cleaned only by the isolated fixture after the test.
  {
    ClipboardSnapshot baseline;
    FormatPayload baseline_text;
    const bool seeded = SeedAndCaptureBaseline(adapter, &baseline,
                                               &baseline_text);
    InstallCaseHooks(&hooks, &faults, &ledger);
    ConfigureFailure(&faults, ClipboardApiCall::close, 1, 2);
    const OperationResult result =
        adapter->Publish(adapter->Revision(), plan);
    const bool counts = CountsEqual(faults, ClipboardApiCall::open, 1, 1) &&
        CountsEqual(faults, ClipboardApiCall::empty, 1, 1) &&
        CountsEqual(faults, ClipboardApiCall::set, 3, 3) &&
        CountsEqual(faults, ClipboardApiCall::close, 2, 0);
    hooks.DisableFaults();
    const bool fixture_cleanup_succeeded = ::CloseClipboard() != FALSE;
    ClipboardSnapshot readback;
    const bool retained = fixture_cleanup_succeeded &&
        ReadClipboardSnapshot(adapter, &readback) &&
        api_fault_test::HasExactPrefix(readback, plan, plan.size());
    AddCase(&results, kCaseIds[9], seeded && counts && retained &&
        result.status == OperationStatus::partial_write &&
        result.reason == "publication-unconfirmed" &&
        result.clipboard_may_have_changed && result.write_revision.has_value() &&
        SameKeys(result.written_keys, KeysThrough(plan, plan.size())) &&
        result.missing_keys.empty() &&
        ledger.IsExactFor(plan, KeysThrough(plan, plan.size())));
  }

  // 11. If Empty and the first Close both fail, the prior content remains intact.
  {
    ClipboardSnapshot baseline;
    FormatPayload baseline_text;
    const bool seeded = SeedAndCaptureBaseline(adapter, &baseline,
                                               &baseline_text);
    InstallCaseHooks(&hooks, &faults, &ledger);
    ConfigureFailure(&faults, ClipboardApiCall::empty);
    ConfigureFailure(&faults, ClipboardApiCall::close);
    const OperationResult result =
        adapter->Publish(adapter->Revision(), plan);
    const bool calls = CountsEqual(faults, ClipboardApiCall::open, 1, 1) &&
        CountsEqual(faults, ClipboardApiCall::empty, 1, 0) &&
        CountsEqual(faults, ClipboardApiCall::set, 0, 0) &&
        CountsEqual(faults, ClipboardApiCall::close, 2, 1);
    hooks.DisableFaults();
    AddCase(&results, kCaseIds[10], seeded && calls &&
        result.status == OperationStatus::write_failed &&
        !result.clipboard_may_have_changed && result.written_keys.empty() &&
        result.missing_keys.empty() && ledger.IsExactFor(plan, {}) &&
        BaselineUnchanged(adapter, baseline, baseline_text));
  }

  // 12. Remove all hooks after a fault and prove the adapter can publish again.
  {
    ClipboardSnapshot baseline;
    FormatPayload baseline_text;
    const bool seeded = SeedAndCaptureBaseline(adapter, &baseline,
                                               &baseline_text);
    InstallCaseHooks(&hooks, &faults, &ledger);
    ConfigureFailure(&faults, ClipboardApiCall::open, 1, 5);
    const OperationResult blocked =
        adapter->Publish(adapter->Revision(), plan);
    const bool blocked_cleanly =
        blocked.status == OperationStatus::clipboard_busy &&
        ledger.IsExactFor(plan, {}) &&
        CountsEqual(faults, ClipboardApiCall::open, 5, 0) &&
        CountsEqual(faults, ClipboardApiCall::empty, 0, 0) &&
        CountsEqual(faults, ClipboardApiCall::set, 0, 0) &&
        CountsEqual(faults, ClipboardApiCall::close, 0, 0);
    ClipboardApiFaultTestAccess::ClearHooks(adapter);
    hooks.ClearFaultPlan(&faults);
    const OperationResult recovered =
        adapter->Publish(adapter->Revision(), plan);
    ClipboardSnapshot readback;
    const bool recovered_bytes = ReadClipboardSnapshot(adapter, &readback) &&
        api_fault_test::HasExactPrefix(readback, plan, plan.size());
    AddCase(&results, kCaseIds[11], seeded && blocked_cleanly &&
        recovered.status == OperationStatus::committed &&
        recovered.clipboard_may_have_changed && recovered_bytes &&
        SameKeys(recovered.written_keys, KeysThrough(plan, plan.size())) &&
        recovered.missing_keys.empty());
  }

  return results;
}

}  // namespace clipboard_format_probe
