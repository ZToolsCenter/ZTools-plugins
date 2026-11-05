#pragma once

#include "clipboard_self_test.h"
#include "clipboard_probe.h"

#include <vector>

namespace clipboard_format_probe {

void AddNativeNotRunCases(ProbeReport* report);
bool RejectsInvalidNativePlans(Win32ClipboardAdapter* adapter,
                               const std::vector<FormatPayload>& recovery);
bool CapturesOverLimitAsIncomplete(
    Win32ClipboardAdapter* adapter,
    const std::vector<FormatPayload>& recovery);
std::vector<CaseResult> RunNativeFormatCases(Win32ClipboardAdapter* adapter);

}  // namespace clipboard_format_probe
