#pragma once

#include "clipboard_self_test.h"

namespace clipboard_format_probe {
class Win32ClipboardAdapter;

// Central suite registration keeps lifecycle/scenario code independent of the
// growing format/fault suite catalogue. A null adapter records not-run cases.
void AddExtendedCases(ProbeReport* report, Win32ClipboardAdapter* adapter);
void AddNotRunCases(ProbeReport* report);
void AddClipboardDependentCasesNotRun(ProbeReport* report, const char* reason);
}  // namespace clipboard_format_probe
