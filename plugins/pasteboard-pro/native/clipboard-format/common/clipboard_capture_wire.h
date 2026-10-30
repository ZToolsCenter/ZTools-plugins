#pragma once

#include "clipboard_capture_codec.h"

#include <cstddef>
#include <cstdint>
#include <iosfwd>
#include <string>
#include <vector>

namespace clipboard_format_probe {

struct CaptureWireRowV1 {
  std::uint32_t item_index = 0;
  std::string native_name;
  bool captured = true;
  std::string reason_code;
  const std::uint8_t* bytes = nullptr;
  std::size_t byte_length = 0;
  std::string sha256;
  std::string fidelity = "exact";
  std::string derived_from;
  std::optional<CaptureCodecV2> native_codec;
};

struct CaptureWireV1 {
  std::string request_id;
  std::string platform;
  std::string expected_revision;
  std::string captured_revision;
  std::string observed_revision;
  std::string policy_revision;
  bool partial = false;
  bool capture_allowed = false;
  bool local_history_allowed = false;
  bool cloud_upload_allowed = false;
  std::vector<CaptureWireRowV1> rows;
};

bool WriteCaptureWireV1(const CaptureWireV1& capture, std::ostream* output);
bool WriteCaptureWireV2(const CaptureWireV1& capture, std::ostream* output);

}  // namespace clipboard_format_probe
