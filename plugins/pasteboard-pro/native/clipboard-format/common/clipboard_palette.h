#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace clipboard_codecs {

inline constexpr std::uint16_t kLogicalPaletteVersion = 0x0300;
inline constexpr std::size_t kMaximumPaletteEntries = 256;
inline constexpr std::size_t kMaximumPaletteBytes =
    4 + kMaximumPaletteEntries * 4;

struct PaletteEntry {
  std::uint8_t red = 0;
  std::uint8_t green = 0;
  std::uint8_t blue = 0;
  std::uint8_t flags = 0;
};

struct PaletteLayout {
  std::uint16_t version = 0;
  std::uint16_t entry_count = 0;
  std::size_t logical_bytes = 0;
};

bool AnalyzePalette(const std::uint8_t* bytes, std::size_t size,
                    PaletteLayout* layout);
bool EncodePalette(const std::vector<PaletteEntry>& entries,
                   std::vector<std::uint8_t>* bytes);

}  // namespace clipboard_codecs
