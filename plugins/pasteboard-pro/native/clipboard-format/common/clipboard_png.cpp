#include "clipboard_png.h"

#include <algorithm>
#include <array>
#include <cstring>
#include <limits>

namespace clipboard_codecs {
namespace {

constexpr std::array<std::uint8_t, 8> kPngSignature = {
    0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a};
constexpr std::size_t kMaximumChunkCount = 100000;

constexpr std::uint32_t CrcEntry(std::uint32_t value) {
  for (int bit = 0; bit < 8; ++bit) {
    value = (value & 1u) != 0 ? (value >> 1) ^ 0xedb88320u : value >> 1;
  }
  return value;
}

constexpr std::array<std::uint32_t, 256> MakeCrcTable() {
  std::array<std::uint32_t, 256> table{};
  for (std::size_t index = 0; index < table.size(); ++index) {
    table[index] = CrcEntry(static_cast<std::uint32_t>(index));
  }
  return table;
}

constexpr auto kCrcTable = MakeCrcTable();

std::uint32_t ReadBigEndian32(const std::uint8_t* bytes) {
  return (static_cast<std::uint32_t>(bytes[0]) << 24) |
         (static_cast<std::uint32_t>(bytes[1]) << 16) |
         (static_cast<std::uint32_t>(bytes[2]) << 8) |
         static_cast<std::uint32_t>(bytes[3]);
}

std::uint32_t Crc32(const std::uint8_t* bytes, std::size_t size) {
  std::uint32_t crc = 0xffffffffu;
  for (std::size_t index = 0; index < size; ++index) {
    const auto table_index = static_cast<std::uint8_t>(crc ^ bytes[index]);
    crc = kCrcTable[table_index] ^ (crc >> 8);
  }
  return crc ^ 0xffffffffu;
}

bool IsAsciiLetter(std::uint8_t value) {
  return (value >= 'A' && value <= 'Z') || (value >= 'a' && value <= 'z');
}

bool IsColorDepthValid(std::uint8_t color, std::uint8_t depth) {
  switch (color) {
    case 0:
      return depth == 1 || depth == 2 || depth == 4 || depth == 8 ||
             depth == 16;
    case 2:
      return depth == 8 || depth == 16;
    case 3:
      return depth == 1 || depth == 2 || depth == 4 || depth == 8;
    case 4:
    case 6:
      return depth == 8 || depth == 16;
    default:
      return false;
  }
}

std::uint8_t ChannelsForColor(std::uint8_t color) {
  switch (color) {
    case 0:
    case 3:
      return 1;
    case 2:
      return 3;
    case 4:
      return 2;
    case 6:
      return 4;
    default:
      return 0;
  }
}

bool CheckedAdd(std::uint64_t left, std::uint64_t right,
                std::uint64_t* result) {
  if (right > std::numeric_limits<std::uint64_t>::max() - left) return false;
  *result = left + right;
  return true;
}

bool CheckedMultiply(std::uint64_t left, std::uint64_t right,
                     std::uint64_t* result) {
  if (left != 0 && right > std::numeric_limits<std::uint64_t>::max() / left) {
    return false;
  }
  *result = left * right;
  return true;
}

std::uint64_t PassExtent(std::uint32_t extent, std::uint8_t start,
                         std::uint8_t step) {
  if (extent <= start) return 0;
  return (static_cast<std::uint64_t>(extent) - start + step - 1) / step;
}

bool CalculateExpandedBytes(const PngLayout& layout,
                            std::uint64_t* filtered_bytes,
                            std::uint64_t* decoded_bytes) {
  const std::uint64_t bits_per_pixel =
      static_cast<std::uint64_t>(ChannelsForColor(layout.color_type)) *
      layout.bit_depth;
  if (!CheckedMultiply(layout.pixel_count, 4, decoded_bytes)) return false;

  constexpr std::array<std::uint8_t, 7> kPassX = {0, 4, 0, 2, 0, 1, 0};
  constexpr std::array<std::uint8_t, 7> kPassY = {0, 0, 4, 0, 2, 0, 1};
  constexpr std::array<std::uint8_t, 7> kPassDx = {8, 8, 4, 4, 2, 2, 1};
  constexpr std::array<std::uint8_t, 7> kPassDy = {8, 8, 8, 4, 4, 2, 2};
  const std::size_t pass_count = layout.interlace_method == 0 ? 1 : 7;
  std::uint64_t total = 0;
  for (std::size_t pass = 0; pass < pass_count; ++pass) {
    const std::uint64_t width = PassExtent(
        layout.width, layout.interlace_method == 0 ? 0 : kPassX[pass],
        layout.interlace_method == 0 ? 1 : kPassDx[pass]);
    const std::uint64_t height = PassExtent(
        layout.height, layout.interlace_method == 0 ? 0 : kPassY[pass],
        layout.interlace_method == 0 ? 1 : kPassDy[pass]);
    if (width == 0 || height == 0) continue;

    std::uint64_t row_bits = 0;
    if (!CheckedMultiply(width, bits_per_pixel, &row_bits) ||
        !CheckedAdd(row_bits, 7, &row_bits)) {
      return false;
    }
    const std::uint64_t row_bytes = row_bits / 8;
    std::uint64_t filtered_row_bytes = 0;
    std::uint64_t pass_bytes = 0;
    if (!CheckedAdd(row_bytes, 1, &filtered_row_bytes) ||
        !CheckedMultiply(filtered_row_bytes, height, &pass_bytes) ||
        !CheckedAdd(total, pass_bytes, &total)) {
      return false;
    }
  }
  *filtered_bytes = total;
  return true;
}

bool Fail(PngLayout* layout, std::string* error, const char* reason) {
  if (layout != nullptr) *layout = {};
  if (error != nullptr) *error = reason;
  return false;
}

bool IsKnownCriticalChunk(const std::uint8_t* type) {
  return std::memcmp(type, "IHDR", 4) == 0 ||
         std::memcmp(type, "PLTE", 4) == 0 ||
         std::memcmp(type, "IDAT", 4) == 0 ||
         std::memcmp(type, "IEND", 4) == 0;
}

}  // namespace

bool AnalyzePng(const std::uint8_t* bytes, std::size_t size, PngLayout* layout,
                std::string* error) {
  if (layout == nullptr) return Fail(nullptr, error, "layout is required");
  *layout = {};
  if (error != nullptr) error->clear();
  if (bytes == nullptr || size < kPngSignature.size() + 25 ||
      size > kMaximumPngBytes) {
    return Fail(layout, error, "PNG allocation is empty, truncated, or too large");
  }
  if (!std::equal(kPngSignature.begin(), kPngSignature.end(), bytes)) {
    return Fail(layout, error, "PNG signature is invalid");
  }

  PngLayout parsed;
  std::size_t cursor = kPngSignature.size();
  std::size_t chunk_count = 0;
  std::uint64_t idat_bytes = 0;
  std::uint16_t palette_entries = 0;
  bool saw_header = false;
  bool saw_palette = false;
  bool saw_idat = false;
  bool idat_ended = false;

  while (cursor <= size && size - cursor >= 12) {
    if (++chunk_count > kMaximumChunkCount) {
      return Fail(layout, error, "PNG has too many chunks");
    }
    const std::uint32_t chunk_length = ReadBigEndian32(bytes + cursor);
    if (chunk_length > 0x7fffffffu ||
        static_cast<std::size_t>(chunk_length) > size - cursor - 12) {
      return Fail(layout, error, "PNG chunk length is invalid");
    }
    const auto* type = bytes + cursor + 4;
    const auto* data = bytes + cursor + 8;
    const std::size_t type_and_data_length =
        static_cast<std::size_t>(chunk_length) + 4;
    const std::size_t checksum_offset =
        cursor + 8 + static_cast<std::size_t>(chunk_length);
    if (!IsAsciiLetter(type[0]) || !IsAsciiLetter(type[1]) ||
        !IsAsciiLetter(type[2]) || !IsAsciiLetter(type[3]) ||
        (type[2] & 0x20u) != 0) {
      return Fail(layout, error, "PNG chunk type is invalid");
    }
    if (Crc32(type, type_and_data_length) !=
        ReadBigEndian32(bytes + checksum_offset)) {
      return Fail(layout, error, "PNG chunk CRC is invalid");
    }

    const bool is_header = std::memcmp(type, "IHDR", 4) == 0;
    const bool is_palette = std::memcmp(type, "PLTE", 4) == 0;
    const bool is_idat = std::memcmp(type, "IDAT", 4) == 0;
    const bool is_end = std::memcmp(type, "IEND", 4) == 0;
    if (std::memcmp(type, "acTL", 4) == 0 ||
        std::memcmp(type, "fcTL", 4) == 0 ||
        std::memcmp(type, "fdAT", 4) == 0) {
      return Fail(layout, error, "APNG animation is unsupported");
    }

    if (!saw_header && !is_header) {
      return Fail(layout, error, "IHDR must be the first PNG chunk");
    }
    if (saw_idat && !is_idat) idat_ended = true;
    if (is_idat && idat_ended) {
      return Fail(layout, error, "PNG IDAT chunks must be consecutive");
    }

    if (is_header) {
      if (saw_header || cursor != kPngSignature.size() || chunk_length != 13) {
        return Fail(layout, error, "PNG IHDR is duplicated or malformed");
      }
      parsed.width = ReadBigEndian32(data);
      parsed.height = ReadBigEndian32(data + 4);
      parsed.bit_depth = data[8];
      parsed.color_type = data[9];
      parsed.interlace_method = data[12];
      if (parsed.width == 0 || parsed.height == 0 ||
          parsed.width > kMaximumPngSide ||
          parsed.height > kMaximumPngSide) {
        return Fail(layout, error, "PNG dimensions exceed the side limit");
      }
      if (!IsColorDepthValid(parsed.color_type, parsed.bit_depth) ||
          data[10] != 0 || data[11] != 0 || parsed.interlace_method > 1) {
        return Fail(layout, error, "PNG IHDR methods or color depth are invalid");
      }
      if (!CheckedMultiply(parsed.width, parsed.height, &parsed.pixel_count) ||
          parsed.pixel_count > kMaximumPngPixels) {
        return Fail(layout, error, "PNG pixel count exceeds its budget");
      }
      saw_header = true;
    } else if (is_palette) {
      if (!saw_header || saw_palette || saw_idat || chunk_length == 0 ||
          chunk_length > 768 || chunk_length % 3 != 0 ||
          parsed.color_type == 0 || parsed.color_type == 4) {
        return Fail(layout, error, "PNG palette placement or length is invalid");
      }
      palette_entries = static_cast<std::uint16_t>(chunk_length / 3);
      if (parsed.color_type == 3 &&
          palette_entries > (1u << parsed.bit_depth)) {
        return Fail(layout, error, "PNG palette exceeds its bit depth");
      }
      saw_palette = true;
    } else if (is_idat) {
      if (!saw_header ||
          (parsed.color_type == 3 && !saw_palette) ||
          chunk_length > std::numeric_limits<std::uint64_t>::max() -
                             idat_bytes) {
        return Fail(layout, error, "PNG IDAT placement is invalid");
      }
      idat_bytes += chunk_length;
      saw_idat = true;
    } else if (is_end) {
      if (!saw_header || !saw_idat || idat_bytes == 0 || chunk_length != 0) {
        return Fail(layout, error, "PNG IEND placement or content is invalid");
      }
      const std::size_t logical_bytes = checksum_offset + 4;
      if (!CalculateExpandedBytes(parsed, &parsed.filtered_scanline_bytes,
                                  &parsed.decoded_bytes)) {
        return Fail(layout, error, "PNG expanded size overflows");
      }
      parsed.expanded_bytes =
          std::max(parsed.filtered_scanline_bytes, parsed.decoded_bytes);
      if (parsed.expanded_bytes > kMaximumPngExpandedBytes) {
        return Fail(layout, error, "PNG expanded size exceeds its budget");
      }
      parsed.logical_bytes = logical_bytes;
      *layout = parsed;
      return true;
    } else if ((type[0] & 0x20u) == 0 && !IsKnownCriticalChunk(type)) {
      return Fail(layout, error, "unknown critical PNG chunk is unsupported");
    }

    cursor = checksum_offset + 4;
  }
  return Fail(layout, error, "PNG is missing a complete IEND chunk");
}

}  // namespace clipboard_codecs
