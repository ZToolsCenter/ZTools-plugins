#include "clipboard_tiff_wic.h"

#include "clipboard_wic_decode.h"
#include "../common/clipboard_tiff.h"

#include <cstddef>
#include <cstdint>
#include <limits>
#include <new>
#include <stdexcept>
#include <string>
#include <vector>

namespace clipboard_format_probe {
namespace {

void SetError(std::string* error, const char* reason) noexcept {
  if (error == nullptr) return;
  try {
      *error = reason;
  } catch (...) {
    error->clear();
  }
}

bool Fail(std::string* error, const char* reason) noexcept {
  SetError(error, reason);
  return false;
}

}  // namespace

bool ValidateTiffPixels(const std::vector<std::uint8_t>& bytes,
                        std::string* error) {
  if (error != nullptr) error->clear();
  try {
    if (bytes.empty() || bytes.size() > clipboard_codecs::kMaximumTiffBytes) {
      return Fail(error, "TIFF bytes exceed their limit");
    }

    clipboard_codecs::TiffLayout layout;
    std::string analyze_error;
    if (!clipboard_codecs::AnalyzeTiff(bytes.data(), bytes.size(), &layout,
                                       &analyze_error) ||
        layout.logical_bytes != bytes.size()) {
      return Fail(error, analyze_error.empty()
                             ? "TIFF payload failed structural validation"
                             : analyze_error.c_str());
    }
    if (layout.frames.empty() ||
        layout.frames.size() > clipboard_codecs::kMaximumTiffFrames ||
        layout.decoded_bytes > clipboard_codecs::kMaximumTiffExpandedBytes) {
      return Fail(error, "TIFF frame count or decoded allocation exceeds its limit");
    }

    std::vector<WicFrameExpectation> expected_frames;
    expected_frames.reserve(layout.frames.size());
    std::uint64_t computed_total_bytes = 0;
    for (const clipboard_codecs::TiffFrameLayout& frame : layout.frames) {
      if (frame.width == 0 || frame.height == 0 ||
          frame.width > clipboard_codecs::kMaximumTiffSide ||
          frame.height > clipboard_codecs::kMaximumTiffSide) {
        return Fail(error, "TIFF frame dimensions exceed their limit");
      }
      const std::uint64_t pixels =
          static_cast<std::uint64_t>(frame.width) * frame.height;
      if (pixels > clipboard_codecs::kMaximumTiffPixels ||
          pixels > std::numeric_limits<std::uint64_t>::max() / 4) {
        return Fail(error, "TIFF frame pixel count exceeds its limit");
      }
      const std::uint64_t rgba_bytes = pixels * 4;
      if (frame.decoded_bytes != rgba_bytes ||
          computed_total_bytes >
              clipboard_codecs::kMaximumTiffExpandedBytes - rgba_bytes) {
        return Fail(error, "TIFF decoded allocation exceeds its limit");
      }
      computed_total_bytes += rgba_bytes;
      expected_frames.push_back(
          WicFrameExpectation{frame.width, frame.height, rgba_bytes});
    }
    if (computed_total_bytes != layout.decoded_bytes) {
      return Fail(error, "TIFF decoded size does not match frame layout");
    }

    return ValidateWicContainerFrames(bytes, GUID_ContainerFormatTiff,
                                      expected_frames,
                                      clipboard_codecs::kMaximumTiffExpandedBytes,
                                      error);
  } catch (const std::bad_alloc&) {
    return Fail(error, "TIFF validation allocation failed");
  } catch (const std::length_error&) {
    return Fail(error, "TIFF validation allocation exceeds its limit");
  }
}

}  // namespace clipboard_format_probe
