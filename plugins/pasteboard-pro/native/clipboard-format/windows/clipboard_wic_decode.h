#pragma once

#include <windows.h>
#include <wincodec.h>

#include <cstdint>
#include <string>
#include <vector>

namespace clipboard_format_probe {

struct WicFrameExpectation {
  std::uint32_t width = 0;
  std::uint32_t height = 0;
  std::uint64_t decoded_bytes = 0;
};

// Decodes every expected frame to a bounded RGBA validation buffer. Pixel data
// is discarded after validation; this never rewrites the supplied bytes.
bool ValidateWicContainerFrames(
    const std::vector<std::uint8_t>& bytes, REFGUID expected_container,
    const std::vector<WicFrameExpectation>& expected_frames,
    std::uint64_t maximum_total_decoded_bytes, std::string* error);

}  // namespace clipboard_format_probe
