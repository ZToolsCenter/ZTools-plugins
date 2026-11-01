#include "clipboard_capture_validation.h"

#include "clipboard_png_wic.h"
#include "clipboard_tiff_wic.h"

namespace clipboard_format_probe {

std::vector<std::string> ValidateCapturedImageFormats(
    std::vector<FormatPayload>* formats,
    const ImagePixelValidator& png_validator,
    const ImagePixelValidator& tiff_validator) {
  std::vector<std::string> missing;
  if (formats == nullptr) return missing;

  for (auto current = formats->begin(); current != formats->end();) {
    const bool is_tiff = current->key == "tiff";
    const bool is_png = current->key == "png" || current->key == "image-png";
    if (!is_tiff && !is_png) {
      ++current;
      continue;
    }

    bool valid = false;
    try {
      std::string error;
      const auto& validator = is_tiff ? tiff_validator : png_validator;
      valid = validator ? validator(current->bytes, &error)
          : is_tiff ? ValidateTiffPixels(current->bytes, &error)
                    : ValidatePngPixels(current->bytes, &error);
    } catch (...) {
      // Preserve other owned representations when one decoder cannot validate.
      valid = false;
    }
    if (valid) {
      ++current;
      continue;
    }
    missing.push_back(current->key);
    current = formats->erase(current);
  }
  return missing;
}

}  // namespace clipboard_format_probe
