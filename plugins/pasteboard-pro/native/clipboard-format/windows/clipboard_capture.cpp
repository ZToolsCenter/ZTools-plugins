#include "clipboard_probe.h"
#include "clipboard_native_api.h"
#include "clipboard_formats.h"
#include "clipboard_capture_policy.h"
#include "clipboard_capture_validation.h"
#include "clipboard_resource_session.h"

#include <algorithm>
#include <limits>
#include <utility>

namespace clipboard_format_probe {

OperationResult Win32ClipboardAdapter::Capture(
    std::optional<std::uint32_t> expected_revision,
    ClipboardSnapshot* output) {
  ClipboardNativeApi native_api(api_faults_for_testing_);
  OperationResult result;
  if (output != nullptr) *output = ClipboardSnapshot{};
  result.expected_revision =
      expected_revision.value_or(GetClipboardSequenceNumber());
  if (window_ == nullptr || output == nullptr) {
    result.status = OperationStatus::session_failed;
    result.reason = "adapter is not initialized";
    result.observed_revision = GetClipboardSequenceNumber();
    return result;
  }

  if (capture_policy_.paused) {
    result.status = OperationStatus::policy_denied;
    result.observed_revision = GetClipboardSequenceNumber();
    result.reason = CaptureDenialCode(CaptureDenial::paused);
    return result;
  }

  constexpr int kOpenAttempts = 5;
  bool opened = false;
  std::uint32_t revision_before_open = 0;
  for (int attempt = 0; attempt < kOpenAttempts; ++attempt) {
    const auto candidate = GetClipboardSequenceNumber();
    if (candidate != result.expected_revision) {
      result.status = OperationStatus::superseded;
      result.observed_revision = candidate;
      result.reason = "clipboard changed before the capture lock";
      return result;
    }
    if (native_api.Open(window_)) {
      opened = true;
      revision_before_open = candidate;
      break;
    }
    Sleep(10 * (attempt + 1));
  }
  if (!opened) {
    result.status = OperationStatus::clipboard_busy;
    result.observed_revision = GetClipboardSequenceNumber();
    result.reason = "clipboard remained locked after bounded retries";
    return result;
  }

  ClipboardResourceSession clipboard_lock(&native_api);
  ClipboardSnapshot captured;
  captured.revision_before_open = revision_before_open;
  const auto revision_while_open = GetClipboardSequenceNumber();
  if (revision_while_open != result.expected_revision) {
    const bool closed = clipboard_lock.Close();
    result.observed_revision = GetClipboardSequenceNumber();
    if (!closed) {
      result.status = OperationStatus::read_failed;
      result.reason = "CloseClipboard failed after a revision mismatch";
    } else {
      result.status = OperationStatus::superseded;
      result.reason = "clipboard revision changed while opening";
    }
    return result;
  }

  HWND owner = GetClipboardOwner();
  if (owner != nullptr) {
    GetWindowThreadProcessId(owner, &captured.owner_process_id);
  }

  std::vector<UINT> available_formats;
  bool format_enumeration_complete = true;
  UINT previous_format = 0;
  while (true) {
    SetLastError(ERROR_SUCCESS);
    const UINT next_format = EnumClipboardFormats(previous_format);
    const DWORD enum_error = GetLastError();
    if (next_format == 0) {
      if (enum_error != ERROR_SUCCESS) {
        format_enumeration_complete = false;
        result.missing_keys.emplace_back("format-enumeration-failed");
      }
      break;
    }
    if (available_formats.size() >= kMaximumFormats) {
      format_enumeration_complete = false;
      result.missing_keys.emplace_back("format-enumeration-limit");
      break;
    }
    available_formats.push_back(next_format);
    previous_format = next_format;
  }

  if (available_formats.empty() && result.missing_keys.empty()) {
    result.missing_keys.emplace_back("empty-clipboard");
  }

  const auto preflight = PreflightCapture(
      owner, revision_before_open, available_formats,
      format_enumeration_complete);
  const auto owner_observation =
      CheckClipboardCaptureOwner(preflight.owner, revision_before_open);
  if (!preflight.receipt.capture_allowed ||
      owner_observation == ClipboardOwnerStability::unstable) {
    const bool closed = clipboard_lock.Close();
    result.observed_revision = GetClipboardSequenceNumber();
    result.status = closed ? OperationStatus::policy_denied
                           : OperationStatus::read_failed;
    result.reason = closed
        ? CaptureDenialCode(preflight.receipt.capture_allowed
                                ? CaptureDenial::source_unstable
                                : preflight.receipt.denial)
        : "CloseClipboard failed after capture policy preflight";
    return result;
  }
  captured.owner_process_id = preflight.owner.process_id;
  captured.capture_policy = preflight.receipt;

  std::size_t total_bytes = 0;
  std::size_t supported_format_count = 0;
  bool saw_unsupported_format = false;
  for (const UINT available : available_formats) {
    if (available == monitor_exclusion_id_ ||
        available == local_history_marker_id_ ||
        available == cloud_upload_marker_id_) {
      continue;
    }
    auto described = DescribeFormat(available, unicode_text_id_, html_id_,
                                   rtf_id_, png_id_, image_png_id_);
    if (!described.has_value()) {
      const std::string missing_key =
          "format-id-" + std::to_string(available);
      result.planned_keys.push_back(missing_key);
      result.missing_keys.push_back(missing_key);
      saw_unsupported_format = true;
      continue;
    }
    if (supported_format_count >= kMaximumFormats) {
      result.missing_keys.emplace_back("supported-format-limit");
      break;
    }
    ++supported_format_count;
    result.planned_keys.push_back(described->key);
    HANDLE data = ReadOrdinaryClipboardData(available);
    std::string error;
    const bool copied =
        data != nullptr &&
        (available == CF_BITMAP
             ? CopyBitmapToDib(reinterpret_cast<HBITMAP>(data), &*described,
                               &error)
             : available == CF_PALETTE
                   ? CopyPaletteToLogPalette(reinterpret_cast<HPALETTE>(data),
                                             &*described, &error)
                   : CopyGlobalMemory(data, &*described, &error));
    if (!copied) {
      result.missing_keys.push_back(described->key);
      continue;
    }
    if (described->bytes.size() > kMaximumClipboardBytes - total_bytes) {
      result.missing_keys.push_back(described->key);
      continue;
    }
    total_bytes += described->bytes.size();
    captured.formats.push_back(std::move(*described));
  }

  const bool owner_stable_after_materialization =
      CheckClipboardCaptureOwner(preflight.owner, revision_before_open) !=
      ClipboardOwnerStability::unstable;
  captured.revision_after_materialization = GetClipboardSequenceNumber();
  const bool captured_revision_is_stable =
      captured.revision_after_materialization == revision_before_open;
  const bool closed = clipboard_lock.Close();
  result.observed_revision = GetClipboardSequenceNumber();
  if (!closed) {
    result.status = OperationStatus::read_failed;
    result.reason = "CloseClipboard failed after capture";
    return result;
  }
  if (!owner_stable_after_materialization || !captured_revision_is_stable) {
    result.status = OperationStatus::superseded;
    result.reason = "clipboard owner or revision changed during capture";
    return result;
  }

  if (expected_revision.has_value() &&
      captured.revision_before_open != *expected_revision) {
    result.status = OperationStatus::superseded;
    result.reason = "clipboard revision did not match the capture request";
    return result;
  }

  auto invalid_image_keys = ValidateCapturedImageFormats(
      &captured.formats, png_validator_for_testing_, tiff_validator_for_testing_);
  result.missing_keys.insert(result.missing_keys.end(),
                             invalid_image_keys.begin(),
                             invalid_image_keys.end());
  result.observed_revision = GetClipboardSequenceNumber();
  captured.missing_keys = result.missing_keys;
  *output = std::move(captured);
  result.status = result.missing_keys.empty()
                      ? OperationStatus::committed
                      : saw_unsupported_format
                            ? OperationStatus::unsupported_format
                            : OperationStatus::partial_capture;
  if (saw_unsupported_format) {
    result.reason = "one or more advertised formats are outside the allowlist";
  } else if (available_formats.empty()) {
    result.reason = "clipboard has no advertised formats";
  } else if (!result.missing_keys.empty()) {
    result.reason = "one or more advertised formats could not be copied or validated";
  }
  return result;
}


}  // namespace clipboard_format_probe
