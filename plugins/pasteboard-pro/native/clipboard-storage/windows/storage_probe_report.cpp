#include "storage_probe_report.h"
#include <iostream>

namespace pasteboard_storage {
namespace {
std::string_view Reason(Status status) {
  switch (status) {
    case Status::ok: return "unexpected-success";
    case Status::invalid_request: return "invalid-request";
    case Status::token_unavailable: return "token-unavailable";
    case Status::unsupported_security_context: return "unsupported-security-context";
    case Status::create_failed: return "create-failed";
    case Status::inspection_failed: return "inspection-failed";
    case Status::acl_rejected: return "acl-rejected";
    case Status::type_rejected: return "type-rejected";
    case Status::reparse_rejected: return "reparse-rejected";
    case Status::hardlink_rejected: return "hardlink-rejected";
    case Status::identity_mismatch: return "identity-mismatch";
    case Status::file_flush_failed: return "file-flush-failed";
    case Status::close_failed: return "close-failed";
    case Status::cleanup_incomplete: return "cleanup-incomplete";
  }
  return "invalid-request";
}
}  // namespace

void ProbeReport::Record(std::string_view id, Status actual, Status expected) {
  for (std::size_t i = 0; i < kFoundationCases.size(); ++i) {
    if (kFoundationCases[i] != id) continue;
    cases[i].status = actual == expected ? "PASS" : "FAIL";
    cases[i].reason = actual == expected
      ? (expected == Status::ok ? "ok" : "expected-rejection") : Reason(actual);
    if (id == "directory-flush-call-observed" && actual == Status::ok) cases[i].reason = "api-observed";
    return;
  }
}

void ProbeReport::Cleanup(bool passed) {
  for (std::size_t i = 0; i < kFoundationCases.size(); ++i) {
    if (kFoundationCases[i] != "owned-fixture-cleanup") continue;
    cases[i] = { passed ? "PASS" : "FAIL", passed ? "ok" : "cleanup-failed" };
  }
}

std::string_view ProbeReport::Execution() const {
  bool all_pass = true;
  bool all_not_run = true;
  for (const auto& item : cases) {
    all_pass = all_pass && item.status == "PASS";
    all_not_run = all_not_run && item.status == "NOT-RUN";
  }
  return all_pass ? "PASS" : all_not_run ? "NOT-RUN" : "FAIL";
}

void ProbeReport::Write() const {
  std::string_view observed = "not-run";
  if (directory_flush == DirectoryFlushObservation::api_success) observed = "api-success";
  if (directory_flush == DirectoryFlushObservation::api_rejected) observed = "api-rejected";
  std::cout << "{\"schemaVersion\":1,\"probe\":\"windows-storage-foundation\",\"execution\":\""
    << Execution() << "\",\"isolation\":\"owned-temporary-directory\","
    << "\"namespaceDurability\":\"NOT-VERIFIED\",\"productionStorageEnabled\":false,"
    << "\"gateComplete\":false,\"directoryFlushCall\":\"" << observed << "\",\"cases\":[";
  for (std::size_t i = 0; i < cases.size(); ++i) {
    if (i != 0) std::cout << ',';
    std::cout << "{\"id\":\"" << kFoundationCases[i] << "\",\"status\":\"" << cases[i].status
      << "\",\"reason\":\"" << cases[i].reason << "\"}";
  }
  std::cout << "]}\n";
}
}  // namespace pasteboard_storage
