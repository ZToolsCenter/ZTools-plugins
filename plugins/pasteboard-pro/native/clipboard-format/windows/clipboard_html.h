#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>

namespace clipboard_format_probe {

std::optional<std::size_t> FindHtmlPayloadLength(
    const std::uint8_t* bytes, std::size_t size);

}  // namespace clipboard_format_probe
