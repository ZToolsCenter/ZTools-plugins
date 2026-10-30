#include "clipboard_png_wic.h"

#include "clipboard_wic_decode.h"
#include "../common/clipboard_png.h"

#include <new>
#include <stdexcept>

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

bool ValidatePngPixels(const std::vector<std::uint8_t>& bytes,
                       std::string* error) {
  if (error != nullptr) error->clear();
  try {
    clipboard_codecs::PngLayout layout;
    std::string analyze_error;
    if (!clipboard_codecs::AnalyzePng(bytes.data(), bytes.size(), &layout,
                                      &analyze_error) ||
        layout.logical_bytes != bytes.size()) {
      return Fail(error, analyze_error.empty()
                             ? "PNG payload failed structural validation"
                             : analyze_error.c_str());
    }
    if (layout.decoded_bytes > clipboard_codecs::kMaximumPngExpandedBytes) {
      return Fail(error, "PNG decode allocation exceeds its limit");
    }

    const std::vector<WicFrameExpectation> frames = {
        {layout.width, layout.height, layout.decoded_bytes}};
    return ValidateWicContainerFrames(bytes, GUID_ContainerFormatPng, frames,
                                      clipboard_codecs::kMaximumPngExpandedBytes,
                                      error);
  } catch (const std::bad_alloc&) {
    return Fail(error, "PNG validation allocation failed");
  } catch (const std::length_error&) {
    return Fail(error, "PNG validation allocation exceeds its limit");
  }
}

}  // namespace clipboard_format_probe
