#pragma once

#include <cstddef>
#include <cstdint>

namespace clipboard_format_probe {

inline constexpr std::size_t kMaximumRtfFramingBytes = 10 * 1024 * 1024;

struct RtfFraming {
  std::size_t root_end = 0;
  std::size_t logical_length = 0;
};

// Validates bounded RTF framing only. This does not decode text, validate
// semantic control-word relationships, or establish content privacy.
bool AnalyzeRtfFraming(const std::uint8_t* bytes, std::size_t size,
                       RtfFraming* framing) noexcept;

}  // namespace clipboard_format_probe
