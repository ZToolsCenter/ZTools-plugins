#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace clipboard_codecs {

inline constexpr std::size_t kMaximumPngBytes = 8u * 1024u * 1024u;
inline constexpr std::uint32_t kMaximumPngSide = 8192;
inline constexpr std::uint64_t kMaximumPngPixels = 32ull * 1024ull * 1024ull;
inline constexpr std::uint64_t kMaximumPngExpandedBytes =
    256ull * 1024ull * 1024ull;

struct PngLayout {
  std::size_t logical_bytes = 0;
  std::uint32_t width = 0;
  std::uint32_t height = 0;
  std::uint64_t pixel_count = 0;
  std::uint64_t decoded_bytes = 0;
  std::uint64_t filtered_scanline_bytes = 0;
  std::uint64_t expanded_bytes = 0;
  std::uint8_t bit_depth = 0;
  std::uint8_t color_type = 0;
  std::uint8_t interlace_method = 0;
};

// Analyzes one PNG stored at the beginning of a bounded allocation. Bytes after
// IEND are treated as allocation padding and excluded from logical_bytes; the
// PNG bytes themselves are never rewritten. IDAT's zlib stream and pixels are
// validated by the platform decoder, not by this structural parser.
bool AnalyzePng(const std::uint8_t* bytes, std::size_t size, PngLayout* layout,
                std::string* error = nullptr);

}  // namespace clipboard_codecs
