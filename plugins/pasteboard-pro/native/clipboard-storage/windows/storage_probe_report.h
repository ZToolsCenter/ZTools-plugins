#pragma once
#include "private_storage.h"
#include "storage_probe_cases.h"
#include <array>
#include <string>
#include <string_view>

namespace pasteboard_storage {
struct ProbeCase {
  std::string_view status = "NOT-RUN";
  std::string_view reason = "prerequisite-unavailable";
};
struct ProbeReport {
  std::array<ProbeCase, kFoundationCases.size()> cases{};
  DirectoryFlushObservation directory_flush = DirectoryFlushObservation::not_run;
  void Record(std::string_view id, Status actual, Status expected = Status::ok);
  void Cleanup(bool passed);
  std::string_view Execution() const;
  void Write() const;
};
}  // namespace pasteboard_storage
