#pragma once

#include "clipboard_probe.h"
#include "clipboard_self_test.h"

#include <vector>

namespace clipboard_format_probe {

// Runs only when adapter belongs to the private ClipboardFormatProbe station.
std::vector<CaseResult> RunPngFormatCases(Win32ClipboardAdapter* adapter);

}  // namespace clipboard_format_probe
