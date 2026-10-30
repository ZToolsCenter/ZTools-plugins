#include "clipboard_self_test.h"
#include "clipboard_self_test_fixtures.h"
#include "clipboard_self_test_comparison.h"
#include "clipboard_self_test_native.h"
#include "clipboard_self_test_registry.h"

#include "clipboard_formats.h"
#include "clipboard_probe.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <string>
#include <utility>
#include <vector>
#include <windows.h>

namespace clipboard_format_probe {
namespace {

void AddCase(ProbeReport* report, std::string id, std::string status,
             std::string detail) {
  report->cases.push_back(
      CaseResult{std::move(id), std::move(status), std::move(detail)});
}

bool PumpUntilUpdate(Win32ClipboardAdapter* adapter, UINT before,
                     DWORD timeout_ms) {
  const ULONGLONG deadline = GetTickCount64() + timeout_ms;
  while (GetTickCount64() < deadline) {
    if (adapter->ClipboardUpdateCount() > before) return true;
    MSG message{};
    bool dispatched = false;
    while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
      if (message.message == WM_QUIT) return false;
      TranslateMessage(&message);
      DispatchMessageW(&message);
      dispatched = true;
    }
    if (!dispatched) {
      const ULONGLONG now = GetTickCount64();
      if (now >= deadline) break;
      const DWORD remaining = static_cast<DWORD>(deadline - now);
      MsgWaitForMultipleObjectsEx(0, nullptr, std::min<DWORD>(remaining, 50),
                                  QS_ALLINPUT, MWMO_INPUTAVAILABLE);
    }
  }
  return adapter->ClipboardUpdateCount() > before;
}

bool InjectSyntheticUnsupportedFormat(Win32ClipboardAdapter* adapter,
                                      UINT format_id) {
  constexpr std::array<std::uint8_t, 8> synthetic = {
      0x53, 0x59, 0x4e, 0x54, 0x48, 0x45, 0x54, 0x49};
  HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, synthetic.size());
  if (memory == nullptr) return false;
  auto* target = static_cast<std::uint8_t*>(GlobalLock(memory));
  if (target == nullptr) {
    GlobalFree(memory);
    return false;
  }
  std::memcpy(target, synthetic.data(), synthetic.size());
  GlobalUnlock(memory);
  if (!OpenClipboard(adapter->Window())) {
    GlobalFree(memory);
    return false;
  }
  const bool written = SetClipboardData(format_id, memory) != nullptr;
  if (written) memory = nullptr;
  const bool closed = CloseClipboard() != FALSE;
  if (memory != nullptr) GlobalFree(memory);
  return written && closed;
}


}  // namespace

ProbeReport RunSelfTest() {
  ProbeReport report;
  ReadEnvironment(&report);
  IsolatedWindowStation station;
  std::string error;
  if (!station.Enter(&error)) {
    AddCase(&report, "station-isolation", "fail", error);
    AddNotRunCases(&report);
    AddNativeNotRunCases(&report);
    std::string cleanup_error;
    if (!station.Restore(&cleanup_error)) {
      AddCase(&report, "station-cleanup", "fail", cleanup_error);
    } else {
      AddCase(&report, "station-cleanup", "pass",
              "partial station resources were released");
    }
    return report;
  }

  Win32ClipboardAdapter adapter;
  if (!adapter.Initialize(&error)) {
    AddCase(&report, "station-isolation", "pass",
            "created a private noninteractive station and desktop");
    AddCase(&report, "listener-window", "fail", error);
    adapter.Shutdown();
    if (!station.Restore(&error)) {
      AddCase(&report, "station-cleanup", "fail", error);
    } else {
      AddCase(&report, "station-cleanup", "pass", "restored caller station");
    }
    AddNotRunCases(&report);
    AddNativeNotRunCases(&report);
    return report;
  }

  AddCase(&report, "station-isolation", "pass",
          "created a private noninteractive station and desktop");

  // Never clear even the private clipboard unless it is proven empty.
  bool private_clipboard_empty = false;
  if (OpenClipboard(adapter.Window())) {
    SetLastError(ERROR_SUCCESS);
    const UINT first = EnumClipboardFormats(0);
    const DWORD enum_error = GetLastError();
    const BOOL closed = CloseClipboard();
    private_clipboard_empty = first == 0 && enum_error == ERROR_SUCCESS && closed;
  }
  if (!private_clipboard_empty) {
    AddCase(&report, "private-clipboard-empty", "fail",
            "private station clipboard was not provably empty; no test write was attempted");
    AddNotRunCases(&report);
    AddNativeNotRunCases(&report);
    adapter.Shutdown();
    if (!station.Restore(&error)) {
      AddCase(&report, "station-cleanup", "fail", error);
    } else {
      AddCase(&report, "station-cleanup", "pass", "restored caller station");
    }
    return report;
  }
  AddCase(&report, "private-clipboard-empty", "pass",
          "private clipboard was empty before the first write");

  ClipboardSnapshot empty_snapshot;
  const OperationResult empty_capture =
      adapter.Capture(adapter.Revision(), &empty_snapshot);
  const bool empty_not_committed =
      empty_capture.status == OperationStatus::partial_capture &&
      empty_capture.planned_keys.empty() &&
      empty_capture.missing_keys == std::vector<std::string>{"empty-clipboard"} &&
      empty_snapshot.formats.empty() &&
      empty_snapshot.missing_keys == std::vector<std::string>{"empty-clipboard"};
  AddCase(&report, "empty-clipboard-not-committed",
          empty_not_committed ? "pass" : "fail",
          empty_not_committed
              ? "an empty clipboard was represented as incomplete"
              : "an empty clipboard was incorrectly accepted as complete");

  const UINT unicode_id = CF_UNICODETEXT;
  const UINT html_id = RegisterClipboardFormatW(L"HTML Format");
  const UINT rtf_id = RegisterClipboardFormatW(L"Rich Text Format");
  const UINT png_id = RegisterClipboardFormatW(L"PNG");
  const UINT invalid_id = RegisterClipboardFormatW(L"ClipboardProbeInvalid");
  const std::vector<FormatPayload> fixtures = {
      test_fixtures::MakeText(unicode_id), test_fixtures::MakeHtml(html_id), test_fixtures::MakeRtf(rtf_id), test_fixtures::MakePng(png_id)};
  const std::vector<FormatPayload> fragment_fixtures = {
      fixtures[0], test_fixtures::MakeHtmlFragmentOnly(html_id), fixtures[2], fixtures[3]};
  std::string html_validation_error;
  const bool fragment_only_valid =
      IsPayloadWellFormed(fragment_fixtures[1], &html_validation_error);
  AddCase(&report, "cf-html-no-context",
          fragment_only_valid ? "pass" : "fail",
          fragment_only_valid
              ? "CF_HTML -1 offsets validated without exposing payload bytes"
              : "CF_HTML -1 offsets were rejected during validation");
  FormatPayload normal_start_late = fixtures[1];
  FormatPayload normal_start_early = fixtures[1];
  FormatPayload fragment_start_late = fragment_fixtures[1];
  FormatPayload fragment_start_early = fragment_fixtures[1];
  const bool offsets_mutated =
      self_test_comparison::ShiftHtmlStartFragment(&normal_start_late, 1) &&
      self_test_comparison::ShiftHtmlStartFragment(&normal_start_early, -1) &&
      self_test_comparison::ShiftHtmlStartFragment(&fragment_start_late, 1) &&
      self_test_comparison::ShiftHtmlStartFragment(&fragment_start_early, -1);
  std::string invalid_offset_error;
  const bool invalid_offsets_rejected = offsets_mutated &&
      !IsPayloadWellFormed(normal_start_late, &invalid_offset_error) &&
      !IsPayloadWellFormed(normal_start_early, &invalid_offset_error) &&
      !IsPayloadWellFormed(fragment_start_late, &invalid_offset_error) &&
      !IsPayloadWellFormed(fragment_start_early, &invalid_offset_error);
  AddCase(&report, "cf-html-fragment-offset-rejection",
          invalid_offsets_rejected ? "pass" : "fail",
          invalid_offsets_rejected
              ? "forward and backward StartFragment offsets were rejected"
              : "misaligned StartFragment offsets passed validation");
  const std::uint32_t before_publish = adapter.Revision();
  const UINT updates_before = adapter.ClipboardUpdateCount();
  const OperationResult first_publish = adapter.Publish(before_publish, fixtures);
  if (!self_test_comparison::PublishWroteExactly(first_publish, fixtures)) {
    AddCase(&report, "capture-publish", "fail",
            "the initial four-format batch did not commit completely");
    AddCase(&report, "listener-notification", "not-run",
            "initial batch publication failed");
    AddCase(&report, "second-batch-retention", "not-run",
            "initial batch publication failed");
    AddClipboardDependentCasesNotRun(&report,
                                     "initial batch publication failed");
  } else {
    const bool notified = PumpUntilUpdate(&adapter, updates_before, 1500);
    AddCase(&report, "listener-notification", notified ? "pass" : "fail",
            notified ? "clipboard listener received a bounded update"
                     : "listener update timed out after batch publication");

    ClipboardSnapshot first_capture;
    const OperationResult first_read =
        adapter.Capture(first_publish.observed_revision, &first_capture);
    std::string baseline_error;
    const bool baseline_complete =
        self_test_comparison::CompleteCaptureMatchesPublished(
            fixtures, first_read, first_capture, false, &baseline_error);
    const std::vector<FormatPayload> frozen_formats =
        baseline_complete ? first_capture.formats : std::vector<FormatPayload>{};
    OperationResult full_set_publish;
    ClipboardSnapshot full_set_capture;
    OperationResult full_set_read;
    bool full_set_round_trip = false;
    if (baseline_complete) {
      full_set_publish = adapter.Publish(first_read.observed_revision,
                                         frozen_formats);
      if (self_test_comparison::PublishWroteExactly(full_set_publish,
                                                    frozen_formats)) {
        full_set_read = adapter.Capture(full_set_publish.observed_revision,
                                       &full_set_capture);
        full_set_round_trip =
            self_test_comparison::CompleteCaptureMatchesExactly(
                frozen_formats, full_set_read, full_set_capture, false);
      }
    }
    const bool capture_publish_pass = baseline_complete && full_set_round_trip;
    AddCase(&report, "capture-publish",
            capture_publish_pass ? "pass" : "fail",
            capture_publish_pass
                ? "all seed bytes survived; the complete captured format set replayed with exact bytes and metadata"
                : baseline_complete
                    ? "the frozen complete format set changed during replay"
                    : "a seed, supported synthesized representation, or typed capture was missing: " + baseline_error);

    bool second_round_trip = false;
    bool downstream_ready = baseline_complete;
    std::vector<FormatPayload> active_fixtures;
    if (baseline_complete) {
      std::vector<FormatPayload> full_fragment_fixtures = frozen_formats;
      const auto html = std::find_if(
          full_fragment_fixtures.begin(), full_fragment_fixtures.end(),
          [](const FormatPayload& format) { return format.key == "html"; });
      if (html != full_fragment_fixtures.end()) {
        *html = test_fixtures::MakeHtmlFragmentOnly(html_id);
      }
      const OperationResult second_publish =
          html != full_fragment_fixtures.end()
              ? adapter.Publish(adapter.Revision(), full_fragment_fixtures)
              : OperationResult{};
      ClipboardSnapshot second_capture;
      const OperationResult second_read =
          self_test_comparison::PublishWroteExactly(second_publish,
                                                    full_fragment_fixtures)
              ? adapter.Capture(second_publish.observed_revision,
                                &second_capture)
              : OperationResult{};
      second_round_trip =
          html != full_fragment_fixtures.end() &&
          self_test_comparison::CompleteCaptureMatchesExactly(
              full_fragment_fixtures, second_read, second_capture, false);
      AddCase(&report, "second-batch-retention",
              second_round_trip ? "pass" : "fail",
              second_round_trip
                  ? "the full frozen format set survived a second batch with fragment-only CF_HTML"
                  : "the second full-format batch lost or changed a captured representation");
      active_fixtures = second_round_trip ? std::move(full_fragment_fixtures)
                                          : frozen_formats;
      if (!second_round_trip) {
        downstream_ready = self_test_comparison::RestoreAndVerifySnapshot(
            &adapter, frozen_formats);
      }
    } else {
      AddCase(&report, "second-batch-retention", "not-run",
              "the initial captured format set was incomplete");
      AddClipboardDependentCasesNotRun(
          &report, "the initial captured format set was incomplete");
    }
    if (downstream_ready) {
      const std::uint32_t stable_revision = adapter.Revision();
      std::uint32_t wrong_revision = stable_revision + 1;
      if (wrong_revision == stable_revision) --wrong_revision;
      const OperationResult mismatch =
          adapter.Publish(wrong_revision, active_fixtures);
      const bool mismatch_rejected =
          mismatch.status == OperationStatus::superseded &&
          !mismatch.clipboard_may_have_changed &&
          adapter.Revision() == stable_revision;
      AddCase(&report, "revision-mismatch",
              mismatch_rejected ? "pass" : "fail",
              mismatch_rejected ? "stale revision rejected"
                               : "stale revision changed clipboard");

      FormatPayload malformed = test_fixtures::MakeHtml(html_id);
      malformed.bytes[0] = 0xff;
      const OperationResult malformed_result =
          adapter.Publish(stable_revision, {malformed});
      FormatPayload unsupported{
          "unknown", L"ClipboardProbeInvalid", invalid_id, {1, 2, 3}};
      const OperationResult unsupported_result =
          adapter.Publish(stable_revision, {unsupported});
      FormatPayload oversized{
          "png", L"PNG", png_id,
          std::vector<std::uint8_t>(8 * 1024 * 1024 + 1, 0)};
      const OperationResult oversized_result =
          adapter.Publish(stable_revision, {oversized});
      const bool invalid_rejected =
          malformed_result.status == OperationStatus::invalid_request &&
          unsupported_result.status == OperationStatus::invalid_request &&
          oversized_result.status == OperationStatus::invalid_request &&
          !malformed_result.clipboard_may_have_changed &&
          !unsupported_result.clipboard_may_have_changed &&
          !oversized_result.clipboard_may_have_changed &&
          adapter.Revision() == stable_revision &&
          RejectsInvalidNativePlans(&adapter, active_fixtures);
      AddCase(&report, "invalid-request",
              invalid_rejected ? "pass" : "fail",
              invalid_rejected ? "invalid requests rejected before clear"
                               : "an invalid request changed clipboard state");

      const bool synthetic_added =
          InjectSyntheticUnsupportedFormat(&adapter, invalid_id);
      const std::uint32_t unknown_revision = adapter.Revision();
      ClipboardSnapshot unknown_snapshot;
      const OperationResult unknown_read =
          synthetic_added ? adapter.Capture(unknown_revision, &unknown_snapshot)
                          : OperationResult{};
      const std::string unknown_key =
          "format-id-" + std::to_string(invalid_id);
      auto expected_unknown_keys =
          self_test_comparison::PayloadKeys(active_fixtures);
      expected_unknown_keys.push_back(unknown_key);
      const bool partial_unknown_reported =
          unknown_read.status == OperationStatus::unsupported_format &&
          self_test_comparison::SameKeys(unknown_read.planned_keys,
                                         expected_unknown_keys) &&
          self_test_comparison::SameKeys(unknown_read.missing_keys,
                                         {unknown_key}) &&
          unknown_snapshot.missing_keys ==
              std::vector<std::string>{unknown_key} &&
          self_test_comparison::HasExactRepresentations(
              active_fixtures, unknown_snapshot, false);
      const OperationResult known_only_publish =
          partial_unknown_reported
              ? adapter.Publish(unknown_read.observed_revision,
                                unknown_snapshot.formats)
              : OperationResult{};
      ClipboardSnapshot known_only_snapshot;
      const OperationResult known_only_read =
          known_only_publish.status == OperationStatus::committed
              ? adapter.Capture(known_only_publish.observed_revision,
                                &known_only_snapshot)
              : OperationResult{};
      const bool unknown_not_replayed =
          synthetic_added && partial_unknown_reported &&
          self_test_comparison::PublishWroteExactly(known_only_publish,
                                                    unknown_snapshot.formats) &&
          self_test_comparison::CompleteCaptureMatchesExactly(
              active_fixtures, known_only_read, known_only_snapshot, false);
      const bool partial_base_ready =
          unknown_not_replayed ||
          self_test_comparison::RestoreAndVerifySnapshot(&adapter,
                                                         active_fixtures);
      AddCase(&report, "unsupported-format-not-replayed",
              unknown_not_replayed ? "pass" : "fail",
              unknown_not_replayed ? "unknown format reported and excluded"
                                   : "unknown format exclusion or replay failed");

      if (partial_base_ready) {
        const std::uint32_t partial_base_revision = adapter.Revision();
        const OperationResult injected =
            adapter.Publish(partial_base_revision, active_fixtures, 2);
        ClipboardSnapshot partial_capture;
        const OperationResult partial_read =
            injected.status == OperationStatus::partial_write
                ? adapter.Capture(injected.observed_revision, &partial_capture)
                : OperationResult{};
        const auto expected_partial_written =
            self_test_comparison::PayloadPrefix(active_fixtures, 2);
        const auto expected_partial_missing = self_test_comparison::PayloadKeys(
            active_fixtures, expected_partial_written.size());
        const bool partial_plan_matches =
            injected.status == OperationStatus::partial_write &&
            injected.clipboard_may_have_changed &&
            injected.planned_keys ==
                self_test_comparison::PayloadKeys(active_fixtures) &&
            injected.written_keys ==
                self_test_comparison::PayloadKeys(expected_partial_written) &&
            injected.missing_keys == expected_partial_missing;
        const bool partial_verified =
            partial_plan_matches &&
            self_test_comparison::CompleteCaptureMatchesPublished(
                expected_partial_written, partial_read, partial_capture, true);
        AddCase(
            &report, "injected-partial-write",
            partial_verified ? "pass" : "fail",
            partial_verified
                ? "the write result reported its full planned set and partial "
                  "capture contained the written seeds plus only documented "
                  "synthesized formats"
                : "partial-write status did not match the private clipboard "
                  "contents");

        const std::uint32_t partial_revision = adapter.Revision();
        const OperationResult restore_batch =
            adapter.Publish(partial_revision, active_fixtures);
        ClipboardSnapshot restored_snapshot;
        const OperationResult restored_read =
            self_test_comparison::PublishWroteExactly(restore_batch,
                                                      active_fixtures)
                ? adapter.Capture(restore_batch.observed_revision,
                                  &restored_snapshot)
                : OperationResult{};
        const bool restored =
            self_test_comparison::CompleteCaptureMatchesExactly(
                active_fixtures, restored_read, restored_snapshot, false);
        AddCase(&report, "post-fault-recovery",
                restored ? "pass" : "fail",
                restored ? "complete frozen snapshot restored after fault"
                         : "full snapshot recovery failed");
      } else {
        AddCase(&report, "injected-partial-write", "not-run",
                "could not restore snapshot after unknown-format exclusion");
        AddCase(&report, "post-fault-recovery", "not-run",
                "could not restore snapshot after unknown-format exclusion");
      }
    } else if (baseline_complete) {
      AddCase(&report, "revision-mismatch", "not-run",
              "the complete frozen snapshot could not be restored");
      AddCase(&report, "invalid-request", "not-run",
              "the complete frozen snapshot could not be restored");
      AddCase(&report, "unsupported-format-not-replayed", "not-run",
              "the complete frozen snapshot could not be restored");
      AddCase(&report, "injected-partial-write", "not-run",
              "the complete frozen snapshot could not be restored");
      AddCase(&report, "post-fault-recovery", "not-run",
              "the complete frozen snapshot could not be restored");
    }
  }

  for (auto& result : RunNativeFormatCases(&adapter)) {
    report.cases.push_back(std::move(result));
  }

  AddExtendedCases(&report, &adapter);
  adapter.Shutdown();
  if (!station.Restore(&error)) {
    AddCase(&report, "station-cleanup", "fail", error);
  } else {
    AddCase(&report, "station-cleanup", "pass", "restored caller station and desktop");
  }
  // The pre-call fault case is narrower than real API/ownership failure coverage.
  // Keep that broader scope unverified until the corresponding gate is executed.
  return report;
}


}  // namespace clipboard_format_probe
