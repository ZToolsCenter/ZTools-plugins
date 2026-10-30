#pragma once

#include "clipboard_probe.h"

namespace clipboard_format_probe {

enum class FormatComparisonMode { exact, allow_visible_bitmap_rgb };
enum class FormatComparison { exact, compatible, mismatch, unconfirmed };

// Compares format identity metadata first, then bytes. The compatible mode is
// narrowly limited to validated 24bpp top-down CF_BITMAP visible RGB pixels.
FormatComparison CompareFormatRepresentations(
    const FormatPayload& expected, const FormatPayload& actual,
    FormatComparisonMode mode);

}  // namespace clipboard_format_probe
