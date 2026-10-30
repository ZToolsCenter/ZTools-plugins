#pragma once

#include "clipboard_probe.h"

#include <optional>
#include <string_view>

namespace clipboard_format_probe {

std::optional<FormatPayload> DescribeUrlFormat(UINT format_id);
std::optional<std::size_t> UrlLogicalLength(const FormatPayload& payload);
std::size_t UrlFormatMaximum(std::string_view key);
bool IsUrlPayloadWellFormed(const FormatPayload& payload);

}  // namespace clipboard_format_probe
