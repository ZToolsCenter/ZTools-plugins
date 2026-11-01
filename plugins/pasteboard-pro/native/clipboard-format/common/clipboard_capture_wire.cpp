#include "clipboard_capture_wire.h"
#include "clipboard_sha256.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <limits>
#include <ostream>
#include <vector>

namespace clipboard_format_probe {
namespace {

constexpr std::size_t kMaximumMetadataBytes = 1024 * 1024;
constexpr std::uint64_t kMaximumPayloadBytes = 200ULL * 1024 * 1024;
constexpr std::size_t kMaximumRows = 1024;
constexpr std::size_t kMaximumRowsPerItem = 32;
constexpr std::size_t kMaximumIdentifierBytes = 128;
constexpr std::size_t kMaximumNativeNameBytes = 512;
constexpr std::size_t kMaximumPolicyRevisionBytes = 512;
constexpr std::size_t kNoRow = std::numeric_limits<std::size_t>::max();

enum class WireVersion { kV1, kV2 };

bool IsTrimWhitespace(std::uint32_t code_point) {
  return (code_point >= 0x09 && code_point <= 0x0d) || code_point == 0x20 ||
         code_point == 0xa0 || code_point == 0x1680 ||
         (code_point >= 0x2000 && code_point <= 0x200a) ||
         code_point == 0x2028 || code_point == 0x2029 || code_point == 0x202f ||
         code_point == 0x205f || code_point == 0x3000 || code_point == 0xfeff;
}

bool IsValidUtf8(const std::string& value, bool reject_controls,
                 bool* has_non_whitespace = nullptr) {
  if (has_non_whitespace) *has_non_whitespace = false;
  std::size_t offset = 0;
  while (offset < value.size()) {
    const auto first = static_cast<std::uint8_t>(value[offset]);
    std::uint32_t code_point = 0;
    std::size_t width = 0;
    if (first <= 0x7f) {
      code_point = first;
      width = 1;
    } else if (first >= 0xc2 && first <= 0xdf) {
      code_point = first & 0x1f;
      width = 2;
    } else if (first >= 0xe0 && first <= 0xef) {
      code_point = first & 0x0f;
      width = 3;
    } else if (first >= 0xf0 && first <= 0xf4) {
      code_point = first & 0x07;
      width = 4;
    } else {
      return false;
    }
    if (width > value.size() - offset) return false;
    for (std::size_t index = 1; index < width; ++index) {
      const auto next = static_cast<std::uint8_t>(value[offset + index]);
      if ((next & 0xc0) != 0x80) return false;
      code_point = (code_point << 6) | (next & 0x3f);
    }
    if ((width == 2 && code_point < 0x80) ||
        (width == 3 && code_point < 0x800) ||
        (width == 4 && code_point < 0x10000) ||
        (code_point >= 0xd800 && code_point <= 0xdfff) ||
        code_point > 0x10ffff) {
      return false;
    }
    if (has_non_whitespace && !IsTrimWhitespace(code_point)) *has_non_whitespace = true;
    if (reject_controls &&
        (code_point <= 0x1f ||
         (code_point >= 0x7f && code_point <= 0x9f))) {
      return false;
    }
    offset += width;
  }
  return true;
}

bool IsCoreIdentifier(const std::string& value) {
  if (value.empty() || value.size() > kMaximumIdentifierBytes) return false;
  auto is_alphanumeric = [](unsigned char byte) {
    return (byte >= 'a' && byte <= 'z') || (byte >= 'A' && byte <= 'Z') ||
           (byte >= '0' && byte <= '9');
  };
  if (!is_alphanumeric(static_cast<unsigned char>(value.front()))) return false;
  for (std::size_t index = 1; index < value.size(); ++index) {
    const unsigned char byte = static_cast<unsigned char>(value[index]);
    if (!is_alphanumeric(byte) && byte != '.' && byte != '_' && byte != ':' &&
        byte != '-') {
      return false;
    }
  }
  return true;
}

bool ParseRevision(const std::string& text, std::uint64_t* value) {
  if (text.empty() || text.size() > 20 ||
      (text.size() > 1 && text.front() == '0')) {
    return false;
  }
  std::uint64_t parsed = 0;
  for (const char character : text) {
    if (character < '0' || character > '9') return false;
    const std::uint64_t digit = static_cast<std::uint64_t>(character - '0');
    if (parsed > (std::numeric_limits<std::uint64_t>::max() - digit) / 10) {
      return false;
    }
    parsed = parsed * 10 + digit;
  }
  *value = parsed;
  return true;
}

bool IsSha256(const std::string& value) {
  if (value.size() != 64) return false;
  for (const char character : value) {
    if (!((character >= '0' && character <= '9') ||
          (character >= 'a' && character <= 'f'))) {
      return false;
    }
  }
  return true;
}

bool IsFidelity(const std::string& value) { return value == "exact" || value == "compatible" || value == "reference"; }

bool IsUnavailableReason(const std::string& value) {
  return value == "unsupported" || value == "timeout" ||
         value == "over-limit" || value == "failed";
}

bool ValidateCapture(const CaptureWireV1& capture,
                     std::vector<std::uint64_t>* offsets,
                     std::uint64_t* payload_length) {
  bool policy_has_value = false;
  if (!IsCoreIdentifier(capture.request_id) ||
      (capture.platform != "macos" && capture.platform != "windows") ||
      capture.policy_revision.empty() ||
      capture.policy_revision.size() > kMaximumPolicyRevisionBytes ||
      !IsValidUtf8(capture.policy_revision, false, &policy_has_value) || !policy_has_value ||
      !capture.capture_allowed || !capture.local_history_allowed ||
      capture.rows.empty() || capture.rows.size() > kMaximumRows) {
    return false;
  }

  std::uint64_t expected = 0;
  std::uint64_t captured = 0;
  std::uint64_t observed = 0;
  if (!ParseRevision(capture.expected_revision, &expected) ||
      !ParseRevision(capture.captured_revision, &captured) ||
      !ParseRevision(capture.observed_revision, &observed) ||
      capture.expected_revision != capture.captured_revision) {
    return false;
  }
  if (capture.platform == "windows" &&
      (expected > std::numeric_limits<std::uint32_t>::max() ||
       captured > std::numeric_limits<std::uint32_t>::max() ||
       observed > std::numeric_limits<std::uint32_t>::max())) {
    return false;
  }

  std::array<std::vector<std::size_t>, 32> item_rows;
  offsets->assign(capture.rows.size(), 0);
  std::uint64_t payload = 0;
  bool has_unavailable = false;
  std::uint32_t previous_item = 0;
  bool have_previous_item = false;
  for (std::size_t index = 0; index < capture.rows.size(); ++index) {
    const CaptureWireRowV1& row = capture.rows[index];
    if (row.item_index > 31 ||
        (have_previous_item && row.item_index < previous_item) ||
        row.native_name.empty() || row.native_name.size() > kMaximumNativeNameBytes ||
        !IsValidUtf8(row.native_name, true)) {
      return false;
    }
    previous_item = row.item_index;
    have_previous_item = true;

    auto& rows_for_item = item_rows[row.item_index];
    if (rows_for_item.size() >= kMaximumRowsPerItem) return false;
    for (const std::size_t existing : rows_for_item) {
      if (capture.rows[existing].native_name == row.native_name) return false;
    }
    rows_for_item.push_back(index);
    (*offsets)[index] = payload;

    if (row.captured) {
      if (!row.reason_code.empty() || (!row.bytes && row.byte_length != 0) ||
          !IsSha256(row.sha256) || !IsFidelity(row.fidelity) ||
          (row.derived_from.size() > kMaximumNativeNameBytes) ||
          (!row.derived_from.empty() &&
           (!IsValidUtf8(row.derived_from, true) || row.derived_from.empty()))) {
        return false;
      }
      if (row.byte_length > kMaximumPayloadBytes - payload) return false;
      payload += static_cast<std::uint64_t>(row.byte_length);
    } else {
      has_unavailable = true;
      if (!IsUnavailableReason(row.reason_code) || row.bytes != nullptr ||
          row.byte_length != 0 || !row.sha256.empty() ||
          row.fidelity != "exact" || !row.derived_from.empty()) {
        return false;
      }
    }
  }
  if (capture.partial != has_unavailable) return false;

  std::vector<std::size_t> derived_targets(capture.rows.size(), kNoRow);
  for (std::size_t index = 0; index < capture.rows.size(); ++index) {
    const CaptureWireRowV1& row = capture.rows[index];
    if (!row.captured || row.derived_from.empty()) continue;
    for (const std::size_t candidate : item_rows[row.item_index]) {
      const CaptureWireRowV1& target = capture.rows[candidate];
      if (target.native_name == row.derived_from) {
        if (!target.captured || candidate == index) return false;
        derived_targets[index] = candidate;
        break;
      }
    }
    if (derived_targets[index] == kNoRow) return false;
  }
  std::vector<std::uint8_t> colors(capture.rows.size(), 0);
  for (std::size_t start = 0; start < capture.rows.size(); ++start) {
    if (colors[start] != 0) continue;
    std::vector<std::size_t> path;
    std::size_t current = start;
    while (current != kNoRow && colors[current] == 0) {
      colors[current] = 1;
      path.push_back(current);
      current = derived_targets[current];
    }
    if (current != kNoRow && colors[current] == 1) return false;
    for (const std::size_t node : path) colors[node] = 2;
  }

  *payload_length = payload;
  return true;
}

bool ValidateNativeCodecs(const CaptureWireV1& capture, WireVersion version) {
  for (const CaptureWireRowV1& row : capture.rows) {
    if (version == WireVersion::kV1) {
      if (row.native_codec) return false;
      continue;
    }
    if (!row.captured) {
      if (row.native_codec) return false;
      continue;
    }
    if (!row.native_codec ||
        !ValidateCaptureCodecV2(*row.native_codec, capture.platform,
                                row.native_name, row.derived_from,
                                row.fidelity, row.bytes, row.byte_length)) {
      return false;
    }
  }
  return true;
}

void AppendQuoted(std::string* output, const std::string& value) {
  constexpr char kHex[] = "0123456789abcdef";
  output->push_back('"');
  for (const unsigned char byte : value) {
    switch (byte) {
      case '"': output->append("\\\""); break;
      case '\\': output->append("\\\\"); break;
      case '\b': output->append("\\b"); break;
      case '\f': output->append("\\f"); break;
      case '\n': output->append("\\n"); break;
      case '\r': output->append("\\r"); break;
      case '\t': output->append("\\t"); break;
      default:
        if (byte < 0x20) {
          output->append("\\u00");
          output->push_back(kHex[byte >> 4]);
          output->push_back(kHex[byte & 0x0f]);
        } else {
          output->push_back(static_cast<char>(byte));
        }
    }
  }
  output->push_back('"');
}

void AppendBoolean(std::string* output, bool value) { output->append(value ? "true" : "false"); }

void AppendNumber(std::string* output, std::uint64_t value) { output->append(std::to_string(value)); }

bool BuildMetadata(const CaptureWireV1& capture,
                   const std::vector<std::uint64_t>& offsets,
                   WireVersion version,
                   std::string* metadata) {
  metadata->clear();
  metadata->reserve(1024);
  metadata->append(version == WireVersion::kV1
                       ? "{\"schemaVersion\":1,\"requestId\":"
                       : "{\"schemaVersion\":2,\"requestId\":");
  AppendQuoted(metadata, capture.request_id);
  metadata->append(",\"platform\":");
  AppendQuoted(metadata, capture.platform);
  metadata->append(",\"expectedRevision\":");
  AppendQuoted(metadata, capture.expected_revision);
  metadata->append(",\"capturedRevision\":");
  AppendQuoted(metadata, capture.captured_revision);
  metadata->append(",\"observedRevision\":");
  AppendQuoted(metadata, capture.observed_revision);
  metadata->append(",\"captureState\":");
  AppendQuoted(metadata, capture.partial ? "partial" : "ready");
  metadata->append(",\"sourceAttribution\":\"unknown\",\"policy\":{\"revision\":");
  AppendQuoted(metadata, capture.policy_revision);
  metadata->append(",\"captureAllowed\":");
  AppendBoolean(metadata, capture.capture_allowed);
  metadata->append(",\"localHistoryAllowed\":");
  AppendBoolean(metadata, capture.local_history_allowed);
  metadata->append(",\"cloudUploadAllowed\":");
  AppendBoolean(metadata, capture.cloud_upload_allowed);
  metadata->append("},\"representations\":[");
  for (std::size_t index = 0; index < capture.rows.size(); ++index) {
    if (index != 0) metadata->push_back(',');
    const CaptureWireRowV1& row = capture.rows[index];
    metadata->append("{\"itemIndex\":");
    AppendNumber(metadata, row.item_index);
    metadata->append(",\"nativeName\":");
    AppendQuoted(metadata, row.native_name);
    metadata->append(",\"state\":");
    AppendQuoted(metadata, row.captured ? "captured" : "unavailable");
    if (row.captured) {
      metadata->append(",\"offset\":");
      AppendNumber(metadata, offsets[index]);
      metadata->append(",\"byteLength\":");
      AppendNumber(metadata, static_cast<std::uint64_t>(row.byte_length));
      metadata->append(",\"sha256\":");
      AppendQuoted(metadata, row.sha256);
      metadata->append(",\"fidelity\":");
      AppendQuoted(metadata, row.fidelity);
      if (!row.derived_from.empty()) {
        metadata->append(",\"derivedFrom\":");
        AppendQuoted(metadata, row.derived_from);
      }
      if (version == WireVersion::kV2) {
        metadata->append(",\"nativeCodec\":");
        AppendCaptureCodecV2Json(metadata, *row.native_codec);
      }
    } else {
      metadata->append(",\"reasonCode\":");
      AppendQuoted(metadata, row.reason_code);
    }
    metadata->push_back('}');
  }
  metadata->append("]}");
  return metadata->size() <= kMaximumMetadataBytes;
}

void PutLittleEndian(std::uint8_t* destination, std::uint64_t value,
                     std::size_t byte_count) {
  for (std::size_t index = 0; index < byte_count; ++index) {
    destination[index] = static_cast<std::uint8_t>(value >> (index * 8));
  }
}

}  // namespace

bool WriteVersion(const CaptureWireV1& capture, std::ostream* output,
                  WireVersion version) {
  if (output == nullptr) return false;
  try {
    if (!output->good()) return false;

    std::vector<std::uint64_t> offsets;
    std::uint64_t payload_length = 0;
    if (!ValidateCapture(capture, &offsets, &payload_length) ||
        !ValidateNativeCodecs(capture, version)) {
      return false;
    }

    std::string metadata;
    if (!BuildMetadata(capture, offsets, version, &metadata)) return false;
    for (const CaptureWireRowV1& row : capture.rows) {
      if (row.captured && PortableSha256Hex(row.bytes, row.byte_length) != row.sha256) {
        return false;
      }
    }

    std::array<std::uint8_t, 20> prefix{};
    const std::array<std::uint8_t, 8> magic = version == WireVersion::kV1
        ? std::array<std::uint8_t, 8>{{'P', 'B', 'C', 'A', 'P', '0', '1', '\n'}}
        : std::array<std::uint8_t, 8>{{'P', 'B', 'C', 'A', 'P', '0', '2', '\n'}};
    std::copy(magic.begin(), magic.end(), prefix.begin());
    PutLittleEndian(prefix.data() + 8,
                    static_cast<std::uint64_t>(metadata.size()), 4);
    PutLittleEndian(prefix.data() + 12, payload_length, 8);

    output->write(reinterpret_cast<const char*>(prefix.data()),
                  static_cast<std::streamsize>(prefix.size()));
    if (!output->good()) return false;
    output->write(metadata.data(), static_cast<std::streamsize>(metadata.size()));
    if (!output->good()) return false;
    for (const CaptureWireRowV1& row : capture.rows) {
      if (!row.captured || row.byte_length == 0) continue;
      output->write(reinterpret_cast<const char*>(row.bytes),
                    static_cast<std::streamsize>(row.byte_length));
      if (!output->good()) return false;
    }
    return output->good();
  } catch (...) {
    return false;
  }
}

bool WriteCaptureWireV1(const CaptureWireV1& capture, std::ostream* output) {
  return WriteVersion(capture, output, WireVersion::kV1);
}

bool WriteCaptureWireV2(const CaptureWireV1& capture, std::ostream* output) {
  return WriteVersion(capture, output, WireVersion::kV2);
}

}  // namespace clipboard_format_probe
