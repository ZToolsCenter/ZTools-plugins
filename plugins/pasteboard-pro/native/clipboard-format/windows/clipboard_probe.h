#pragma once

#include <windows.h>

#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "../common/clipboard_capture_policy.h"

namespace clipboard_format_probe {

struct ClipboardCapturePreflight;
struct ClipboardApiFaultPlan;
struct PreparedFormat;
class ClipboardApiFaultTestAccess;
class ClipboardPolicyTestAccess;
class ClipboardPngTestAccess;
class ClipboardTiffTestAccess;
class ClipboardPublishVerificationTestAccess;
class ClipboardFileReferenceTestAccess;

enum class OperationStatus {
  committed,
  partial_write,
  partial_capture,
  superseded,
  invalid_request,
  unsupported_format,
  clipboard_busy,
  read_failed,
  write_failed,
  session_failed,
  policy_denied,
  file_reference_unavailable,
};

struct FormatPayload {
  std::string key;
  std::wstring native_name;
  // Clipboard representation to publish; this does not identify its origin.
  UINT format_id = 0;
  std::vector<std::uint8_t> bytes;
  std::string encoding;
  // Helper ACP used to validate ANSI HDROP; not producer encoding provenance.
  std::optional<UINT> validation_code_page;
  std::string fidelity;
  // Legacy identity of the currently enumerated representation, not its source.
  std::string source_format;
  std::string source_origin = "unknown";
  std::string materialization;
};

struct ClipboardSnapshot {
  // These revisions bound the bytes materialized while OpenClipboard was held.
  // Later offline validation never relabels the snapshot as newer clipboard data.
  std::uint32_t revision_before_open = 0;
  std::uint32_t revision_after_materialization = 0;
  DWORD owner_process_id = 0;
  std::vector<FormatPayload> formats;
  std::vector<std::string> missing_keys;
  CapturePolicyReceipt capture_policy;
};

struct OperationResult {
  OperationStatus status = OperationStatus::session_failed;
  std::uint32_t expected_revision = 0;
  // Sequence observed for this write while the clipboard session was held.
  std::optional<std::uint32_t> write_revision;
  // Latest clipboard sequence observed when this operation returns. It may be
  // newer than the captured snapshot if the clipboard changes during validation.
  std::uint32_t observed_revision = 0;
  bool clipboard_may_have_changed = false;
  std::vector<std::string> planned_keys;
  std::vector<std::string> written_keys;
  std::vector<std::string> missing_keys;
  std::string reason;
};

class IsolatedWindowStation final {
 public:
  IsolatedWindowStation() = default;
  IsolatedWindowStation(const IsolatedWindowStation&) = delete;
  IsolatedWindowStation& operator=(const IsolatedWindowStation&) = delete;
  ~IsolatedWindowStation();

  bool Enter(std::string* error);
  bool Restore(std::string* error);
  const std::string& StationName() const { return station_name_utf8_; }

 private:
  HWINSTA original_station_ = nullptr;
  HDESK original_thread_desktop_ = nullptr;
  HWINSTA private_station_ = nullptr;
  HDESK private_desktop_ = nullptr;
  bool process_station_switched_ = false;
  bool thread_desktop_switched_ = false;
  std::string station_name_utf8_;
};

class Win32ClipboardAdapter final {
 public:
  Win32ClipboardAdapter() = default;
  Win32ClipboardAdapter(const Win32ClipboardAdapter&) = delete;
  Win32ClipboardAdapter& operator=(const Win32ClipboardAdapter&) = delete;
  ~Win32ClipboardAdapter();

  bool Initialize(std::string* error);
  void Shutdown();
  HWND Window() const { return window_; }
  UINT ClipboardUpdateCount() const { return update_count_; }
  bool IsInitialized() const { return window_ != nullptr; }

  void SetCapturePolicy(CapturePolicyConfig policy);
  const CapturePolicyConfig& CapturePolicyOptions() const {
    return capture_policy_;
  }

  std::uint32_t Revision() const;

  OperationResult Capture(
      std::optional<std::uint32_t> expected_revision = std::nullopt,
      ClipboardSnapshot* output = nullptr);

  OperationResult Publish(
      std::uint32_t expected_revision,
      const std::vector<FormatPayload>& formats,
      std::optional<std::size_t> injected_set_failure_index = std::nullopt);

 private:
  friend class ClipboardApiFaultTestAccess;
  friend class ClipboardPolicyTestAccess;
  friend class ClipboardPngTestAccess;
  friend class ClipboardTiffTestAccess;
  friend class ClipboardPublishVerificationTestAccess;
  friend class ClipboardFileReferenceTestAccess;

  HWND window_ = nullptr;
  ATOM window_class_ = 0;
  UINT unicode_text_id_ = CF_UNICODETEXT;
  UINT html_id_ = 0;
  UINT rtf_id_ = 0;
  UINT png_id_ = 0;
  UINT image_png_id_ = 0;
  UINT monitor_exclusion_id_ = 0;
  UINT local_history_marker_id_ = 0;
  UINT cloud_upload_marker_id_ = 0;
  CapturePolicyConfig capture_policy_;
  ClipboardApiFaultPlan* api_faults_for_testing_ = nullptr;
  std::function<void(PreparedFormat&)> publish_prepared_observer_for_testing_;
  std::function<HANDLE(UINT)> ordinary_reader_for_testing_;
  std::function<bool(const std::vector<std::uint8_t>&, std::string*)>
      png_validator_for_testing_;
  std::function<bool(const std::vector<std::uint8_t>&, std::string*)>
      tiff_validator_for_testing_;
  // Private self-test hooks; these are not renderer-controlled options.
  std::function<HANDLE(UINT)> publish_readback_reader_for_testing_;
  std::function<void(UINT, FormatPayload*)>
      publish_readback_transform_for_testing_;
  std::function<void()> publish_after_close_hook_for_testing_;
  std::function<bool(std::wstring_view, bool)> file_reference_access_for_testing_;
  std::function<void()> publish_before_file_reference_revision_check_for_testing_;
  UINT update_count_ = 0;

  static LRESULT CALLBACK WindowProcedure(
      HWND window, UINT message, WPARAM wparam, LPARAM lparam);
  LRESULT HandleMessage(HWND window, UINT message, WPARAM wparam,
                        LPARAM lparam);
  ClipboardCapturePreflight PreflightCapture(
      HWND owner, std::uint32_t revision,
      const std::vector<UINT>& formats, bool enumeration_complete) const;
  HANDLE ReadOrdinaryClipboardData(UINT format);
};

std::string StableFormatName(UINT format_id);
std::string StatusName(OperationStatus status);
bool IsPayloadWellFormed(const FormatPayload& format, std::string* error);

}  // namespace clipboard_format_probe
