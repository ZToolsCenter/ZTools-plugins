#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace clipboard_format_probe {

// Validates the original PNG payload with Windows Imaging Component. The
// synchronous WIC decode is bounded by dimensions and output allocation, then
// checked against observational CPU/wall budgets. A helper-process watchdog is
// still required to interrupt a decoder call that does not return.
bool ValidatePngPixels(const std::vector<std::uint8_t>& bytes,
                       std::string* error);

}  // namespace clipboard_format_probe
