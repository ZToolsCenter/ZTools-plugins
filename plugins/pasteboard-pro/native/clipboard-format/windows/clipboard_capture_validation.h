#pragma once

#include "clipboard_probe.h"

#include <functional>
#include <string>
#include <vector>

namespace clipboard_format_probe {

using ImagePixelValidator = std::function<bool(
    const std::vector<std::uint8_t>& bytes, std::string* error)>;

// Runs only on the owned capture bytes, after the clipboard resource session
// has closed. Invalid image representations are removed and returned as missing.
std::vector<std::string> ValidateCapturedImageFormats(
    std::vector<FormatPayload>* formats,
    const ImagePixelValidator& png_validator = {},
    const ImagePixelValidator& tiff_validator = {});

}  // namespace clipboard_format_probe
