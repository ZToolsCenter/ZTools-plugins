#include "clipboard_payload_transport.h"

#include "../common/clipboard_capture_wire.h"
#include "../common/clipboard_capture_policy.h"
#include "clipboard_format_receipts.h"
#include "clipboard_probe.h"
#include "clipboard_self_test_fixtures.h"
#include "clipboard_formats.h"

#include <algorithm>
#include <cstdio>
#include <cstdint>
#include <optional>
#include <ostream>
#include <string>
#include <utility>
#include <vector>

namespace clipboard_format_probe {
namespace {

constexpr char kFixtureFailure[] = "capture-fixture-failed\n";
constexpr char kRequestId[] = "fixture-v17";
constexpr char kPolicyRevision[] = "fixture-policy-v17";
constexpr std::size_t kMaximumCaptureFormats = 32;

struct RegisteredFormats {
  UINT html = 0;
  UINT rtf = 0;
  UINT png = 0;
  UINT image_png = 0;
};

void EmitFixtureFailure() {
  std::fputs(kFixtureFailure, stderr);
  std::fflush(stderr);
}

bool RegisterFormats(RegisteredFormats* formats) {
  if (formats == nullptr) return false;
  formats->html = RegisterClipboardFormatW(L"HTML Format");
  formats->rtf = RegisterClipboardFormatW(L"Rich Text Format");
  formats->png = RegisterClipboardFormatW(L"PNG");
  formats->image_png = RegisterClipboardFormatW(L"image/png");
  return formats->html != 0 && formats->rtf != 0 && formats->png != 0 &&
         formats->image_png != 0;
}

bool IsPrivateClipboardEmpty(HWND owner) {
  if (owner == nullptr || !OpenClipboard(owner)) return false;
  SetLastError(ERROR_SUCCESS);
  const UINT first = EnumClipboardFormats(0);
  const DWORD enumeration_error = GetLastError();
  const BOOL closed = CloseClipboard();
  return first == 0 && enumeration_error == ERROR_SUCCESS && closed != FALSE;
}

bool ReadPrivateFormatIds(HWND owner, std::vector<UINT>* output) {
  if (owner == nullptr || output == nullptr || !OpenClipboard(owner)) {
    return false;
  }

  std::vector<UINT> formats;
  bool complete = true;
  UINT previous = 0;
  while (true) {
    SetLastError(ERROR_SUCCESS);
    const UINT next = EnumClipboardFormats(previous);
    const DWORD enumeration_error = GetLastError();
    if (next == 0) {
      complete = enumeration_error == ERROR_SUCCESS;
      break;
    }
    if (formats.size() >= kMaximumCaptureFormats) {
      complete = false;
      break;
    }
    formats.push_back(next);
    previous = next;
  }

  const BOOL closed = CloseClipboard();
  if (!complete || !closed || formats.empty()) return false;
  output->swap(formats);
  return true;
}

std::string NativeNameFor(UINT format_id,
                          const std::optional<FormatPayload>& descriptor) {
  if (descriptor.has_value()) {
    const auto& wide_name = descriptor->native_name;
    if (wide_name.empty()) return {};
    const int required = WideCharToMultiByte(
        CP_UTF8, WC_ERR_INVALID_CHARS, wide_name.data(),
        static_cast<int>(wide_name.size()), nullptr, 0, nullptr, nullptr);
    if (required <= 0) return {};
    std::string name(static_cast<std::size_t>(required), '\0');
    if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, wide_name.data(),
                            static_cast<int>(wide_name.size()), name.data(),
                            required, nullptr, nullptr) != required) {
      return {};
    }
    return name;
  }

  std::string name = StableFormatName(format_id);
  if (name.empty() || name == "unknown") {
    return "format-id-" + std::to_string(format_id);
  }
  return name;
}

std::optional<FormatPayload> Describe(UINT format_id,
                                      const RegisteredFormats& registered) {
  return DescribeFormat(format_id, CF_UNICODETEXT, registered.html,
                        registered.rtf, registered.png,
                        registered.image_png);
}

std::string PlannedKey(UINT format_id,
                       const RegisteredFormats& registered) {
  const auto descriptor = Describe(format_id, registered);
  return descriptor.has_value()
             ? descriptor->key
             : "format-id-" + std::to_string(format_id);
}

bool MapFidelity(const FormatPayload& payload, std::string* fidelity) {
  if (fidelity == nullptr) return false;
  if (payload.fidelity == "representation-bytes-preserved") {
    *fidelity = "exact";
    return true;
  }
  if (payload.fidelity == "visible-rgb-compatible" ||
      payload.fidelity == "palette-entries-preserved") {
    *fidelity = "compatible";
    return true;
  }
  return false;
}

const FormatPayload* FindCapturedFormat(const ClipboardSnapshot& snapshot,
                                        UINT format_id) {
  const auto found = std::find_if(
      snapshot.formats.begin(), snapshot.formats.end(),
      [format_id](const FormatPayload& item) {
        return item.format_id == format_id;
      });
  return found == snapshot.formats.end() ? nullptr : &*found;
}

bool IsCaptureStatusUsable(OperationStatus status) {
  return status == OperationStatus::committed ||
         status == OperationStatus::partial_capture ||
         status == OperationStatus::unsupported_format;
}

bool HasMissingKey(const OperationResult& operation,
                   const std::string& key) {
  return std::find(operation.missing_keys.begin(),
                   operation.missing_keys.end(), key) !=
         operation.missing_keys.end();
}

bool MatchesSeed(const ClipboardSnapshot& snapshot,
                 const FormatPayload& expected) {
  const FormatPayload* actual =
      FindCapturedFormat(snapshot, expected.format_id);
  return actual != nullptr && actual->bytes == expected.bytes &&
         actual->encoding == expected.encoding &&
         actual->fidelity == expected.fidelity &&
         actual->source_origin == "unknown" &&
         actual->native_name == expected.native_name;
}

bool BuildCaptureWire(
    const std::vector<UINT>& native_formats,
    const RegisteredFormats& registered,
    const std::vector<FormatPayload>& seed,
    const OperationResult& operation,
    const ClipboardSnapshot& snapshot,
    CaptureWireV1* output) {
  if (output == nullptr || native_formats.empty() ||
      !IsCaptureStatusUsable(operation.status) ||
      !snapshot.capture_policy.capture_allowed ||
      operation.expected_revision != snapshot.revision_before_open ||
      snapshot.revision_after_materialization !=
          snapshot.revision_before_open) {
    return false;
  }

  std::vector<std::string> planned_keys;
  planned_keys.reserve(native_formats.size());
  for (const UINT format_id : native_formats) {
    planned_keys.push_back(PlannedKey(format_id, registered));
  }
  if (planned_keys != operation.planned_keys) return false;
  for (const auto& missing : operation.missing_keys) {
    if (std::find(planned_keys.begin(), planned_keys.end(), missing) ==
        planned_keys.end()) {
      return false;
    }
  }

  for (const auto& expected : seed) {
    if (!MatchesSeed(snapshot, expected)) return false;
  }

  CaptureWireV1 wire;
  wire.request_id = kRequestId;
  wire.platform = "windows";
  wire.expected_revision = std::to_string(operation.expected_revision);
  wire.captured_revision =
      std::to_string(snapshot.revision_before_open);
  wire.observed_revision = std::to_string(operation.observed_revision);
  wire.policy_revision = kPolicyRevision;
  wire.capture_allowed = snapshot.capture_policy.capture_allowed;
  wire.local_history_allowed =
      snapshot.capture_policy.local_history_permitted;
  wire.cloud_upload_allowed =
      snapshot.capture_policy.cloud_upload_permitted;
  wire.rows.reserve(native_formats.size());

  for (std::size_t index = 0; index < native_formats.size(); ++index) {
    const UINT format_id = native_formats[index];
    const std::string& planned_key = planned_keys[index];
    const auto descriptor = Describe(format_id, registered);
    const FormatPayload* captured = FindCapturedFormat(snapshot, format_id);

    CaptureWireRowV1 row;
    row.item_index = 0;
    row.native_name = NativeNameFor(format_id, descriptor);
    if (row.native_name.empty()) return false;

    if (captured == nullptr) {
      if (!HasMissingKey(operation, planned_key)) return false;
      row.captured = false;
      row.reason_code = descriptor.has_value() ? "failed" : "unsupported";
      wire.partial = true;
      wire.rows.push_back(std::move(row));
      continue;
    }

    // V1 transports native identity and raw bytes, not an encoding field.
    // Keep the adapter's encoding fact local and require it to be present.
    if (!descriptor.has_value() || captured->key != descriptor->key ||
        captured->native_name != descriptor->native_name ||
        captured->source_origin != "unknown" || captured->encoding.empty() ||
        HasMissingKey(operation, planned_key)) {
      return false;
    }

    std::string native_name;
    const int required = WideCharToMultiByte(
        CP_UTF8, WC_ERR_INVALID_CHARS, captured->native_name.data(),
        static_cast<int>(captured->native_name.size()), nullptr, 0, nullptr,
        nullptr);
    if (required <= 0) return false;
    native_name.resize(static_cast<std::size_t>(required));
    if (WideCharToMultiByte(
            CP_UTF8, WC_ERR_INVALID_CHARS, captured->native_name.data(),
            static_cast<int>(captured->native_name.size()), native_name.data(),
            required, nullptr, nullptr) != required ||
        native_name != row.native_name) {
      return false;
    }

    if (!MapFidelity(*captured, &row.fidelity)) return false;
    row.bytes = captured->bytes.data();
    row.byte_length = captured->bytes.size();
    CaptureCodecV2 native_codec;
    native_codec.encoding = captured->encoding;
    native_codec.materialization = captured->materialization;
    if (captured->validation_code_page.has_value()) {
      native_codec.validation_code_page =
          static_cast<std::uint32_t>(*captured->validation_code_page);
    }
    row.native_codec = std::move(native_codec);
    if (!HashWindowsReceiptBytes(row.bytes, row.byte_length, &row.sha256)) {
      return false;
    }
    wire.rows.push_back(std::move(row));
  }

  for (const auto& captured : snapshot.formats) {
    if (std::find(native_formats.begin(), native_formats.end(),
                  captured.format_id) == native_formats.end()) {
      return false;
    }
  }

  if (wire.rows.size() != native_formats.size() ||
      (operation.status == OperationStatus::committed && wire.partial) ||
      (operation.status != OperationStatus::committed && !wire.partial)) {
    return false;
  }

  *output = std::move(wire);
  return true;
}

}  // namespace

int RunCaptureWireFixtureV2(std::ostream* output) {
  IsolatedWindowStation station;
  Win32ClipboardAdapter adapter;
  const auto fail = [&]() {
    adapter.Shutdown();
    station.Restore(nullptr);
    EmitFixtureFailure();
    return 65;
  };

  try {
    if (output == nullptr) return fail();

    std::string ignored_error;
    if (!station.Enter(&ignored_error) ||
        !adapter.Initialize(&ignored_error) ||
        !IsPrivateClipboardEmpty(adapter.Window())) {
      return fail();
    }

    RegisteredFormats registered;
    if (!RegisterFormats(&registered)) return fail();

    std::vector<FormatPayload> seed;
    seed.reserve(3);
    seed.push_back(test_fixtures::MakeText(CF_UNICODETEXT));
    seed.push_back(test_fixtures::MakeHtml(registered.html));
    seed.push_back(test_fixtures::MakeRtf(registered.rtf));

    const std::uint32_t publish_revision = adapter.Revision();
    const OperationResult published =
        adapter.Publish(publish_revision, seed);
    if (published.status != OperationStatus::committed ||
        published.written_keys != published.planned_keys ||
        !published.missing_keys.empty()) {
      return fail();
    }

    const std::uint32_t inventory_revision = adapter.Revision();
    std::vector<UINT> native_formats;
    if (inventory_revision != published.observed_revision ||
        !ReadPrivateFormatIds(adapter.Window(), &native_formats) ||
        adapter.Revision() != inventory_revision) {
      return fail();
    }

    ClipboardSnapshot snapshot;
    const OperationResult captured =
        adapter.Capture(published.observed_revision, &snapshot);
    CaptureWireV1 wire;
    if (!BuildCaptureWire(native_formats, registered, seed, captured,
                          snapshot, &wire)) {
      return fail();
    }

    adapter.Shutdown();
    if (!station.Restore(&ignored_error)) return fail();

    if (!WriteCaptureWireV2(wire, output)) return fail();
    output->flush();
    if (!*output) return fail();
    return 0;
  } catch (...) {
    return fail();
  }
}

}  // namespace clipboard_format_probe
