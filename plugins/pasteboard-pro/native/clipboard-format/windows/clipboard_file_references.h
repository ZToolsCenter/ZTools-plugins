#pragma once

#include "clipboard_probe.h"

#include <functional>
#include <string>
#include <string_view>
#include <vector>

namespace clipboard_format_probe {

using FileReferenceAccessProbe =
    std::function<bool(std::wstring_view path, bool is_directory)>;

// Verifies currently available CF_HDROP references without reading their
// contents. An access probe is private to isolated tests and replaces only
// the final access check; structural and path validation still run first.
bool FileReferencesAvailableForPublish(
    const std::vector<FormatPayload>& formats, std::string* error,
    const FileReferenceAccessProbe& access_probe = {});

}  // namespace clipboard_format_probe
