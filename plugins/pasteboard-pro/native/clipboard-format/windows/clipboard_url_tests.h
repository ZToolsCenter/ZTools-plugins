#pragma once

#include "clipboard_self_test.h"
#include "clipboard_probe.h"

#include <vector>

namespace clipboard_format_probe {

// Call only with the adapter initialized in the self-test's private station.
std::vector<CaseResult> RunUrlFormatCases(Win32ClipboardAdapter* adapter);

}  // namespace clipboard_format_probe
