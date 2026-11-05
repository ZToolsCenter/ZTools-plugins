#include "clipboard_palette.h"

#include <utility>

namespace clipboard_codecs {
namespace {

std::uint16_t Read16(const std::uint8_t* bytes, std::size_t offset) {
  return static_cast<std::uint16_t>(bytes[offset]) |
         (static_cast<std::uint16_t>(bytes[offset + 1]) << 8);
}

void Write16(std::vector<std::uint8_t>* bytes, std::size_t offset,
             std::uint16_t value) {
  (*bytes)[offset] = static_cast<std::uint8_t>(value & 0xff);
  (*bytes)[offset + 1] = static_cast<std::uint8_t>(value >> 8);
}

bool IsSupportedPaletteFlags(std::uint8_t flags) {
  return flags == 0 || flags == 0x01 || flags == 0x02 || flags == 0x04;
}

}  // namespace

bool AnalyzePalette(const std::uint8_t* bytes, std::size_t size,
                    PaletteLayout* output) {
  if (bytes == nullptr || output == nullptr || size < 4 ||
      size > kMaximumPaletteBytes) {
    return false;
  }
  const std::uint16_t version = Read16(bytes, 0);
  const std::uint16_t count = Read16(bytes, 2);
  if (version != kLogicalPaletteVersion || count == 0 ||
      count > kMaximumPaletteEntries) {
    return false;
  }
  const std::size_t logical_bytes = 4 + static_cast<std::size_t>(count) * 4;
  if (size < logical_bytes) return false;
  for (std::size_t index = 0; index < count; ++index) {
    if (!IsSupportedPaletteFlags(bytes[4 + index * 4 + 3])) return false;
  }
  *output = PaletteLayout{version, count, logical_bytes};
  return true;
}

bool EncodePalette(const std::vector<PaletteEntry>& entries,
                   std::vector<std::uint8_t>* output) {
  if (output == nullptr || entries.empty() ||
      entries.size() > kMaximumPaletteEntries) {
    return false;
  }
  std::vector<std::uint8_t> bytes(4 + entries.size() * 4, 0);
  Write16(&bytes, 0, kLogicalPaletteVersion);
  Write16(&bytes, 2, static_cast<std::uint16_t>(entries.size()));
  for (std::size_t index = 0; index < entries.size(); ++index) {
    const auto& entry = entries[index];
    if (!IsSupportedPaletteFlags(entry.flags)) return false;
    bytes[4 + index * 4] = entry.red;
    bytes[4 + index * 4 + 1] = entry.green;
    bytes[4 + index * 4 + 2] = entry.blue;
    bytes[4 + index * 4 + 3] = entry.flags;
  }
  *output = std::move(bytes);
  return true;
}

}  // namespace clipboard_codecs
