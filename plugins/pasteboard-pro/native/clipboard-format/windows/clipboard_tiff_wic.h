#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace clipboard_format_probe {

// Structurally analyzes classic TIFF and decodes every main-IFD page through
// WIC into temporary bounded RGBA buffers. The original representation stays
// byte-for-byte unchanged; this validates decodability, not rendered fidelity.
bool ValidateTiffPixels(const std::vector<std::uint8_t>& bytes,
                        std::string* error);

}  // namespace clipboard_format_probe
