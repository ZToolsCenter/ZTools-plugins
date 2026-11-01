#include "clipboard_probe.h"
#include "clipboard_formats.h"
#include "clipboard_file_references.h"
#include "clipboard_native_api.h"
#include "clipboard_publish_verification.h"
#include "clipboard_resource_session.h"

#include <algorithm>
#include <memory>
#include <utility>

namespace clipboard_format_probe {

OperationResult Win32ClipboardAdapter::Publish(
    std::uint32_t expected_revision,
    const std::vector<FormatPayload>& formats,
    std::optional<std::size_t> injected_set_failure_index) {
  ClipboardNativeApi native_api(api_faults_for_testing_);
  OperationResult result;
  result.expected_revision = expected_revision;
  result.observed_revision = GetClipboardSequenceNumber();

  if (window_ == nullptr || formats.empty() ||
      formats.size() > kMaximumFormats) {
    result.status = OperationStatus::invalid_request;
    result.reason = "adapter is unavailable or the format count is invalid";
    return result;
  }

  std::size_t total_bytes = 0;
  std::vector<std::unique_ptr<PreparedFormat>> prepared;
  std::vector<UINT> seen_format_ids;
  std::vector<std::string> seen_keys;
  prepared.reserve(formats.size());
  for (const auto& format : formats) {
    result.planned_keys.push_back(format.key);
    if (std::find(seen_format_ids.begin(), seen_format_ids.end(),
                  format.format_id) != seen_format_ids.end() ||
        std::find(seen_keys.begin(), seen_keys.end(), format.key) !=
            seen_keys.end() ||
        format.bytes.size() > kMaximumClipboardBytes - total_bytes) {
      result.status = OperationStatus::invalid_request;
      result.reason = "format plan failed preflight; clipboard was not opened";
      return result;
    }

    total_bytes += format.bytes.size();
    seen_format_ids.push_back(format.format_id);
    seen_keys.push_back(format.key);
    std::string validation_error;
    auto item = PrepareFormat(format, &validation_error);
    if (item == nullptr) {
      result.status = OperationStatus::invalid_request;
      result.reason = "format could not be prepared; clipboard was not opened";
      return result;
    }
    prepared.push_back(std::move(item));
  }

  if (publish_prepared_observer_for_testing_) {
    try {
      for (auto& item : prepared) publish_prepared_observer_for_testing_(*item);
    } catch (...) {
      result.status = OperationStatus::invalid_request;
      result.reason = "publication-resource-observation-failed";
      return result;
    }
  }

  bool file_references_available = false;
  try {
    std::string availability_error;
    file_references_available = FileReferencesAvailableForPublish(
        formats, &availability_error, file_reference_access_for_testing_);
    auto hook = std::move(publish_before_file_reference_revision_check_for_testing_);
    publish_before_file_reference_revision_check_for_testing_ = {};
    if (hook) hook();
  } catch (...) {
    file_references_available = false;
  }
  result.observed_revision = GetClipboardSequenceNumber();
  if (result.observed_revision != expected_revision) {
    result.status = OperationStatus::superseded;
    result.reason = "clipboard changed during file reference preflight";
    return result;
  }
  if (!file_references_available) {
    result.status = OperationStatus::file_reference_unavailable;
    result.reason = "file-reference-unavailable";
    return result;
  }

  constexpr int kOpenAttempts = 5;
  bool opened = false;
  for (int attempt = 0; attempt < kOpenAttempts; ++attempt) {
    result.observed_revision = GetClipboardSequenceNumber();
    if (result.observed_revision != expected_revision) {
      result.status = OperationStatus::superseded;
      result.reason = "clipboard changed before publication";
      return result;
    }
    if (native_api.Open(window_)) {
      opened = true;
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
  const auto revision_while_open = GetClipboardSequenceNumber();
  if (revision_while_open != expected_revision) {
    const bool closed = clipboard_lock.Close();
    result.observed_revision = GetClipboardSequenceNumber();
    if (!closed) {
      result.status = OperationStatus::write_failed;
      result.reason = "CloseClipboard failed after a revision mismatch";
    } else {
      result.status = OperationStatus::superseded;
      result.reason = "clipboard changed before the clear operation";
    }
    return result;
  }

  if (!native_api.Empty()) {
    const bool closed = clipboard_lock.Close();
    result.status = OperationStatus::write_failed;
    result.observed_revision = GetClipboardSequenceNumber();
    result.reason = closed
        ? "EmptyClipboard failed before any representation was written"
        : "EmptyClipboard and CloseClipboard both failed";
    return result;
  }
  result.clipboard_may_have_changed = true;

  bool write_failed = false;
  for (std::size_t index = 0; index < prepared.size(); ++index) {
    if (injected_set_failure_index.has_value() &&
        index == *injected_set_failure_index) {
      write_failed = true;
      result.reason = "test fault injected before SetClipboardData";
      break;
    }

    auto& current = *prepared[index];
    if (native_api.Set(current.payload.format_id,
                         current.ClipboardHandle()) == nullptr) {
      write_failed = true;
      result.reason = "SetClipboardData failed";
      break;
    }
    current.MarkTransferred();
    result.written_keys.push_back(current.payload.key);
  }

  if (write_failed) {
    for (const auto& planned : result.planned_keys) {
      if (std::find(result.written_keys.begin(), result.written_keys.end(),
                    planned) == result.written_keys.end()) {
        result.missing_keys.push_back(planned);
      }
    }
    const bool closed = clipboard_lock.Close();
    result.observed_revision = GetClipboardSequenceNumber();
    if (!closed) {
      result.reason = "CloseClipboard failed after publication was attempted";
    }
    result.status = OperationStatus::partial_write;
    if (result.reason.empty()) result.reason = "publication wrote only a subset";
    return result;
  }

  const auto revision_before_readback = GetClipboardSequenceNumber();
  const auto verification = VerifyPublishedFormats(
      prepared, publish_readback_reader_for_testing_,
      publish_readback_transform_for_testing_);
  const bool revision_stable_during_readback =
      GetClipboardSequenceNumber() == revision_before_readback;
  if (revision_stable_during_readback) {
    result.write_revision = revision_before_readback;
  }
  const bool closed = clipboard_lock.Close();
  auto after_close_hook = std::move(publish_after_close_hook_for_testing_);
  publish_after_close_hook_for_testing_ = {};
  bool after_close_hook_completed = true;
  if (closed && after_close_hook) {
    try {
      after_close_hook();
    } catch (...) {
      after_close_hook_completed = false;
    }
  }
  result.observed_revision = GetClipboardSequenceNumber();
  if (!closed || !revision_stable_during_readback ||
      !after_close_hook_completed || !result.write_revision.has_value() ||
      result.observed_revision != *result.write_revision ||
      verification.state == PublishVerificationState::unconfirmed) {
    result.status = OperationStatus::partial_write;
    result.reason = "publication-unconfirmed";
    result.written_keys = result.planned_keys;
    result.missing_keys.clear();
    return result;
  }

  if (verification.state == PublishVerificationState::mismatch) {
    result.status = OperationStatus::partial_write;
    result.reason = "publication-readback-mismatch";
    result.written_keys = verification.verified_keys;
    result.missing_keys = verification.mismatched_keys;
    return result;
  }

  result.status = OperationStatus::committed;
  result.written_keys = verification.verified_keys;
  return result;
}


}  // namespace clipboard_format_probe
