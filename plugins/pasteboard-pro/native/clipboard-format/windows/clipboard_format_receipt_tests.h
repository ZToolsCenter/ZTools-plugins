#pragma once

#include "clipboard_probe.h"
#include "clipboard_self_test.h"

namespace clipboard_format_probe {
// Only called after entering the private window station. A null adapter records
// every dependent case as not-run without opening or reading any clipboard.
void RunWindowsFormatReceiptCases(ProbeReport* report,
                                  Win32ClipboardAdapter* adapter);
}  // namespace clipboard_format_probe
