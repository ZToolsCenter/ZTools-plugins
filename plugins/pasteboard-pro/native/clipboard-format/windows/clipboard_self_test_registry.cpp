#include "clipboard_self_test_registry.h"
#include "clipboard_api_fault_tests.h"
#include "clipboard_format_receipt_tests.h"
#include "clipboard_url_tests.h"
#include "clipboard_policy_tests.h"
#include "clipboard_png_tests.h"
#include "clipboard_publish_tests.h"
#include "clipboard_file_references_tests.h"
#include "clipboard_reparse_tests.h"
#include "clipboard_tiff_tests.h"

#include <algorithm>
#include <utility>

namespace clipboard_format_probe {
namespace {
void AddCase(ProbeReport* report, std::string id, std::string status,
             std::string detail) {
  report->cases.push_back(
      CaseResult{std::move(id), std::move(status), std::move(detail)});
}
}  // namespace

void AddClipboardDependentCasesNotRun(ProbeReport* report,
                                      const char* reason) {
  for (const char* id : {"revision-mismatch", "invalid-request",
                         "unsupported-format-not-replayed",
                         "injected-partial-write", "post-fault-recovery"}) {
    AddCase(report, id, "not-run", reason);
  }
}

void AddExtendedCases(ProbeReport* report, Win32ClipboardAdapter* adapter) {
  for (auto& result : RunApiPublishFaultCases(adapter)) {
    report->cases.push_back(std::move(result));
  }
  for (auto& result : RunApiCaptureFaultCases(adapter)) {
    report->cases.push_back(std::move(result));
  }
  RunWindowsFormatReceiptCases(report, adapter);
  for (auto& result : RunReparseBoundaryCases(adapter)) {
    report->cases.push_back(std::move(result));
  }
  for (auto& result : RunTiffFormatCases(adapter)) {
    report->cases.push_back(std::move(result));
  }
  for (auto& result : RunFileReferenceCases(adapter)) {
    report->cases.push_back(std::move(result));
  }
  for (auto& result : RunPublishVerificationCases(adapter)) {
    report->cases.push_back(std::move(result));
  }
  for (auto& result : RunPngFormatCases(adapter)) {
    report->cases.push_back(std::move(result));
  }
  for (auto& result : RunUrlFormatCases(adapter)) {
    report->cases.push_back(std::move(result));
  }
  for (auto& result : RunPolicyFormatCases(adapter)) {
    report->cases.push_back(std::move(result));
  }
}

void AddNotRunCases(ProbeReport* report) {
  const bool private_empty_recorded = std::any_of(
      report->cases.begin(), report->cases.end(), [](const CaseResult& item) {
        return item.id == "private-clipboard-empty";
      });
  if (!private_empty_recorded) {
    AddCase(report, "private-clipboard-empty", "not-run", "isolated station unavailable");
  }
  AddExtendedCases(report, nullptr);
  AddCase(report, "capture-publish", "not-run", "isolated station unavailable");
  AddCase(report, "empty-clipboard-not-committed", "not-run",
          "isolated station unavailable");
  AddCase(report, "cf-html-no-context", "not-run", "isolated station unavailable");
  AddCase(report, "cf-html-fragment-offset-rejection", "not-run",
          "isolated station unavailable");
  AddCase(report, "second-batch-retention", "not-run", "isolated station unavailable");
  AddCase(report, "revision-mismatch", "not-run", "isolated station unavailable");
  AddCase(report, "invalid-request", "not-run", "isolated station unavailable");
  AddCase(report, "listener-notification", "not-run", "isolated station unavailable");
  AddCase(report, "injected-partial-write", "not-run", "isolated station unavailable");
  AddCase(report, "unsupported-format-not-replayed", "not-run",
          "isolated station unavailable");
  AddCase(report, "post-fault-recovery", "not-run",
          "isolated station unavailable");
}

}  // namespace clipboard_format_probe
