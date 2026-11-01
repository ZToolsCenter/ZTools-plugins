#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>

namespace clipboard_format_probe {

struct CaptureTextEvidenceV2 {
  std::string encoding;
  bool byte_order_mark = false;
  bool null_terminated = false;
  std::string encoding_check;
};

struct CaptureCodecV2 {
  std::string encoding;
  std::string materialization;
  std::optional<std::uint32_t> validation_code_page;
  std::optional<CaptureTextEvidenceV2> text;
};

bool ValidateCaptureCodecV2(const CaptureCodecV2& codec,
                            const std::string& platform,
                            const std::string& native_name,
                            const std::string& derived_from,
                            const std::string& fidelity,
                            const std::uint8_t* bytes,
                            std::size_t byte_length);

void AppendCaptureCodecV2Json(std::string* output,
                              const CaptureCodecV2& codec);

}  // namespace clipboard_format_probe
