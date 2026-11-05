#pragma once

#include "clipboard_self_test.h"
#include "clipboard_probe.h"

#include <vector>

namespace clipboard_format_probe {

std::vector<CaseResult> RunFileReferenceCases(
    Win32ClipboardAdapter* adapter);

}  // namespace clipboard_format_probe
