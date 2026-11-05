#pragma once

#include "clipboard_formats.h"
#include "clipboard_native_api.h"
#include "clipboard_self_test.h"

#include <array>
#include <functional>
#include <string>
#include <vector>

namespace clipboard_format_probe {
class ClipboardApiFaultTestAccess final {
 public:
  static void SetFaults(Win32ClipboardAdapter* adapter,
                        ClipboardApiFaultPlan* plan);
  static void SetPreparedObserver(
      Win32ClipboardAdapter* adapter,
      std::function<void(PreparedFormat&)> observer);
  static void SetOrdinaryReader(Win32ClipboardAdapter* adapter,
                                std::function<HANDLE(UINT)> reader);
  static void ClearHooks(Win32ClipboardAdapter* adapter);
};

namespace api_fault_test {

class HookScope final {
 public:
  explicit HookScope(Win32ClipboardAdapter* adapter);
  HookScope(const HookScope&) = delete;
  HookScope& operator=(const HookScope&) = delete;
  ~HookScope();

  void SetFaults(ClipboardApiFaultPlan* plan);
  void SetObserver(std::function<void(PreparedFormat&)> observer);
  void SetOrdinaryReader(std::function<HANDLE(UINT)> reader);
  void DisableFaults();
  void DisableObserver();
  void ClearFaultPlan(ClipboardApiFaultPlan* plan);

 private:
  Win32ClipboardAdapter* adapter_;
  CapturePolicyConfig original_policy_;
};

struct ReleaseEvent {
  PreparedFormat::Storage storage = PreparedFormat::Storage::none;
  HANDLE handle = nullptr;
  bool transferred = false;
  bool attempted = false;
  bool succeeded = false;
};

class ReleaseLedger final {
 public:
  static constexpr std::size_t kCapacity = 32;

  void Attach(PreparedFormat& format) noexcept;
  bool IsExactFor(const std::vector<FormatPayload>& plan,
                 const std::vector<std::string>& transferred_keys) const;
  std::size_t PreparedCount() const { return prepared_count_; }
  std::size_t ReleaseCount() const { return release_count_; }
  bool Overflowed() const { return overflowed_; }

 private:
  struct PreparedResource {
    PreparedFormat::Storage storage = PreparedFormat::Storage::none;
    HANDLE handle = nullptr;
    std::string key;
  };

  static void Observe(PreparedFormat::Storage storage, HANDLE handle,
                      bool transferred, bool attempted, bool succeeded,
                      void* context) noexcept;
  std::array<PreparedResource, kCapacity> prepared_{};
  std::array<ReleaseEvent, kCapacity> events_{};
  std::size_t prepared_count_ = 0;
  std::size_t release_count_ = 0;
  bool overflowed_ = false;
};

bool IsPrivateProbeStation(const Win32ClipboardAdapter* adapter);
bool ReadClipboardSnapshot(Win32ClipboardAdapter* adapter,
                           ClipboardSnapshot* snapshot);
bool HasExactPayload(const ClipboardSnapshot& snapshot,
                     const FormatPayload& expected);
bool HasExactPrefix(const ClipboardSnapshot& snapshot,
                    const std::vector<FormatPayload>& plan,
                    std::size_t prefix_length);
bool HasNoPlannedPayload(const ClipboardSnapshot& snapshot,
                         const std::vector<FormatPayload>& plan);
bool SeedAndCaptureBaseline(Win32ClipboardAdapter* adapter,
                            ClipboardSnapshot* snapshot,
                            FormatPayload* expected_text);
std::vector<FormatPayload> MakeThreeGlobalFormatPlan(UINT html_id,
                                                     UINT rtf_id);
std::vector<std::string> KeysThrough(const std::vector<FormatPayload>& plan,
                                     std::size_t length);
std::vector<std::string> KeysAfter(const std::vector<FormatPayload>& plan,
                                   std::size_t length);
bool SameKeys(const std::vector<std::string>& left,
              const std::vector<std::string>& right);
bool CountsEqual(const ClipboardApiFaultPlan& plan, ClipboardApiCall call,
                 std::size_t attempts, std::size_t native_calls);
void ConfigureFailure(ClipboardApiFaultPlan* plan, ClipboardApiCall call,
                      std::size_t first_failure_call = 1,
                      std::size_t failures = 1);
void AddCase(std::vector<CaseResult>* results, const char* id, bool passed);
void AddNotRun(std::vector<CaseResult>* results,
               const std::vector<const char*>& ids, const char* detail);

}  // namespace api_fault_test
}  // namespace clipboard_format_probe
