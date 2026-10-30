#pragma once

#include "clipboard_probe.h"
#include "clipboard_self_test.h"

#include <vector>

namespace clipboard_format_probe {

std::vector<CaseResult> RunPolicyFormatCases(
    Win32ClipboardAdapter* adapter);

}  // namespace clipboard_format_probe
