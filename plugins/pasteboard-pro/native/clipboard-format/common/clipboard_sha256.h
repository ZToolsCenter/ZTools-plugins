#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace clipboard_format_probe {

std::string PortableSha256Hex(const std::uint8_t* bytes, std::size_t length);

}  // namespace clipboard_format_probe
