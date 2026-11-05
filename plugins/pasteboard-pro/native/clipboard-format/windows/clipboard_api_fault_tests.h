#pragma once

#include "clipboard_probe.h"
#include "clipboard_self_test.h"

#include <vector>

namespace clipboard_format_probe {

std::vector<CaseResult> RunApiPublishFaultCases(
    Win32ClipboardAdapter* adapter);
std::vector<CaseResult> RunApiCaptureFaultCases(
    Win32ClipboardAdapter* adapter);

}  // namespace clipboard_format_probe
