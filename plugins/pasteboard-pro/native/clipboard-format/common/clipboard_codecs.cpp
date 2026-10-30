#include "clipboard_codecs.h"

#include <algorithm>
#include <limits>

namespace clipboard_codecs {
namespace {

constexpr std::uint32_t kBiRgb = 0;
constexpr std::uint32_t kBiBitfields = 3;
constexpr std::uint32_t kBiAlphaBitfields = 6;
constexpr std::uint32_t kFourCcEmbedded = 0x4d424544;
constexpr std::uint32_t kFourCcLinked = 0x4c494e4b;
constexpr std::size_t kDropFilesHeaderBytes = 20;

bool RangeFits(std::size_t offset, std::size_t length, std::size_t total) {
  return offset <= total && length <= total - offset;
}

std::uint16_t Read16(const std::uint8_t* bytes, std::size_t offset) {
  return static_cast<std::uint16_t>(bytes[offset]) |
         (static_cast<std::uint16_t>(bytes[offset + 1]) << 8);
}

std::uint32_t Read32(const std::uint8_t* bytes, std::size_t offset) {
  return static_cast<std::uint32_t>(bytes[offset]) |
         (static_cast<std::uint32_t>(bytes[offset + 1]) << 8) |
         (static_cast<std::uint32_t>(bytes[offset + 2]) << 16) |
         (static_cast<std::uint32_t>(bytes[offset + 3]) << 24);
}

void Write16(std::vector<std::uint8_t>* bytes, std::size_t offset,
             std::uint16_t value) {
  (*bytes)[offset] = static_cast<std::uint8_t>(value & 0xff);
  (*bytes)[offset + 1] = static_cast<std::uint8_t>(value >> 8);
}

void Write32(std::vector<std::uint8_t>* bytes, std::size_t offset,
             std::uint32_t value) {
  for (std::size_t index = 0; index < 4; ++index) {
    (*bytes)[offset + index] =
        static_cast<std::uint8_t>((value >> (index * 8)) & 0xff);
  }
}

std::int64_t Signed32(std::uint32_t value) {
  return (value & 0x80000000u) != 0
             ? static_cast<std::int64_t>(value) - 0x100000000LL
             : static_cast<std::int64_t>(value);
}

bool AddProduct(std::size_t left, std::size_t right, std::size_t* result) {
  if (right != 0 && left > std::numeric_limits<std::size_t>::max() / right) {
    return false;
  }
  *result = left * right;
  return true;
}

bool Add(std::size_t left, std::size_t right, std::size_t* result) {
  if (left > std::numeric_limits<std::size_t>::max() - right) return false;
  *result = left + right;
  return true;
}

bool ValidMasks(std::uint32_t red, std::uint32_t green, std::uint32_t blue,
                std::uint32_t alpha, std::uint16_t bits_per_pixel) {
  const std::uint32_t all = red | green | blue | alpha;
  const std::uint32_t allowed = bits_per_pixel == 32
                                    ? std::numeric_limits<std::uint32_t>::max()
                                    : (1u << bits_per_pixel) - 1;
  return red != 0 && green != 0 && blue != 0 && (all & ~allowed) == 0 &&
         (red & green) == 0 && (red & blue) == 0 && (green & blue) == 0 &&
         (alpha & (red | green | blue)) == 0;
}

bool IsSupportedHeaderSize(std::uint32_t size) {
  return size == 12 || size == 40 || size == 52 || size == 56 ||
         size == 108 || size == 124;
}

bool AddPaletteBytes(std::uint32_t colors_used, std::uint16_t bits_per_pixel,
                     std::size_t entry_bytes, std::size_t* palette_bytes) {
  std::uint32_t colors = colors_used;
  if (colors == 0 && bits_per_pixel <= 8) colors = 1u << bits_per_pixel;
  if (colors > 1u << 16) return false;
  return AddProduct(static_cast<std::size_t>(colors), entry_bytes,
                    palette_bytes);
}

bool Fail(std::string* error, const char* message) {
  if (error != nullptr) *error = message;
  return false;
}

bool ValidatePathUtf16(const std::u16string& path) {
  if (path.empty() || path.find(u'\0') != std::u16string::npos) return false;
  for (std::size_t index = 0; index < path.size(); ++index) {
    const char16_t unit = path[index];
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= path.size() || path[index + 1] < 0xdc00 ||
          path[index + 1] > 0xdfff) {
        return false;
      }
      ++index;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

}  // namespace

bool IsValidUtf16(const std::uint8_t* bytes, std::size_t byte_length) {
  if (bytes == nullptr || byte_length % 2 != 0) return false;
  for (std::size_t offset = 0; offset < byte_length; offset += 2) {
    const std::uint16_t unit = Read16(bytes, offset);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (offset + 3 >= byte_length) return false;
      const std::uint16_t low = Read16(bytes, offset + 2);
      if (low < 0xdc00 || low > 0xdfff) return false;
      offset += 2;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

bool AnalyzeDib(const std::uint8_t* bytes, std::size_t size,
                DibLayout* output, std::string* error) {
  if (bytes == nullptr || output == nullptr || size < 12 ||
      size > kMaximumDibBytes) {
    return Fail(error, "dib-size-out-of-range");
  }
  const std::uint32_t header_size = Read32(bytes, 0);
  if (!IsSupportedHeaderSize(header_size) || header_size > size) {
    return Fail(error, "dib-header-size-invalid");
  }

  std::uint32_t raw_width = 0;
  std::uint32_t raw_height = 0;
  std::uint16_t planes = 0;
  std::uint16_t bits_per_pixel = 0;
  std::uint32_t compression = kBiRgb;
  std::uint32_t colors_used = 0;
  std::uint32_t image_size = 0;
  std::size_t palette_entry_bytes = 4;
  if (header_size == 12) {
    raw_width = Read16(bytes, 4);
    raw_height = Read16(bytes, 6);
    planes = Read16(bytes, 8);
    bits_per_pixel = Read16(bytes, 10);
    palette_entry_bytes = 3;
  } else {
    raw_width = Read32(bytes, 4);
    raw_height = Read32(bytes, 8);
    planes = Read16(bytes, 12);
    bits_per_pixel = Read16(bytes, 14);
    compression = Read32(bytes, 16);
    image_size = Read32(bytes, 20);
    colors_used = Read32(bytes, 32);
  }

  const std::int64_t signed_width = Signed32(raw_width);
  const std::int64_t signed_height = Signed32(raw_height);
  if (header_size == 12) {
    if (raw_width == 0 || raw_height == 0) {
      return Fail(error, "dib-dimensions-invalid");
    }
  } else if (signed_width <= 0 || signed_height == 0 ||
             signed_height == std::numeric_limits<std::int32_t>::min()) {
    return Fail(error, "dib-dimensions-invalid");
  }
  const std::uint64_t width = header_size == 12
                                  ? raw_width
                                  : static_cast<std::uint64_t>(signed_width);
  const std::uint64_t height = header_size == 12
                                   ? raw_height
                                   : static_cast<std::uint64_t>(
                                         signed_height < 0 ? -signed_height
                                                           : signed_height);
  if (width > 32768 || height > 32768 || planes != 1 ||
      !(bits_per_pixel == 1 || bits_per_pixel == 4 || bits_per_pixel == 8 ||
        bits_per_pixel == 16 || bits_per_pixel == 24 || bits_per_pixel == 32)) {
    return Fail(error, "dib-layout-unsupported");
  }
  if (compression != kBiRgb && compression != kBiBitfields &&
      compression != kBiAlphaBitfields) {
    return Fail(error, "dib-compression-unsupported");
  }
  if (compression != kBiRgb && bits_per_pixel != 16 &&
      bits_per_pixel != 32) {
    return Fail(error, "dib-bitfield-depth-invalid");
  }
  if (header_size == 12 && compression != kBiRgb) {
    return Fail(error, "dib-core-compression-invalid");
  }

  std::size_t row_bits = 0;
  if (!AddProduct(static_cast<std::size_t>(width), bits_per_pixel, &row_bits) ||
      row_bits > std::numeric_limits<std::size_t>::max() - 31) {
    return Fail(error, "dib-row-size-overflow");
  }
  const std::size_t row_bytes = ((row_bits + 31) / 32) * 4;
  std::size_t pixel_bytes = 0;
  if (!AddProduct(row_bytes, static_cast<std::size_t>(height), &pixel_bytes) ||
      pixel_bytes > kMaximumDibBytes ||
      (image_size != 0 &&
       (image_size < pixel_bytes || image_size > kMaximumDibBytes))) {
    return Fail(error, "dib-pixel-size-invalid");
  }

  std::size_t masks_bytes = 0;
  std::uint32_t red = 0;
  std::uint32_t green = 0;
  std::uint32_t blue = 0;
  std::uint32_t alpha = 0;
  if (compression == kBiBitfields || compression == kBiAlphaBitfields) {
    if (header_size == 40) {
      masks_bytes = compression == kBiAlphaBitfields ? 16 : 12;
      if (!RangeFits(header_size, masks_bytes, size)) {
        return Fail(error, "dib-masks-truncated");
      }
      red = Read32(bytes, header_size);
      green = Read32(bytes, header_size + 4);
      blue = Read32(bytes, header_size + 8);
      if (masks_bytes == 16) alpha = Read32(bytes, header_size + 12);
    } else if (header_size >= 52) {
      if (compression == kBiAlphaBitfields && header_size < 56) {
        return Fail(error, "dib-alpha-mask-not-present");
      }
      red = Read32(bytes, 40);
      green = Read32(bytes, 44);
      blue = Read32(bytes, 48);
      if (header_size >= 56) alpha = Read32(bytes, 52);
    } else {
      return Fail(error, "dib-masks-not-present");
    }
    if (!ValidMasks(red, green, blue, alpha, bits_per_pixel) ||
        (compression == kBiAlphaBitfields && alpha == 0)) {
      return Fail(error, "dib-masks-invalid");
    }
  }

  std::size_t palette_bytes = 0;
  if (!AddPaletteBytes(colors_used, bits_per_pixel, palette_entry_bytes,
                       &palette_bytes)) {
    return Fail(error, "dib-palette-size-overflow");
  }
  std::size_t pixel_offset = 0;
  if (!Add(header_size, masks_bytes, &pixel_offset) ||
      !Add(pixel_offset, palette_bytes, &pixel_offset) ||
      pixel_offset > size || !RangeFits(pixel_offset, pixel_bytes, size)) {
    return Fail(error, "dib-pixel-data-truncated");
  }
  if (image_size != 0 && image_size > size - pixel_offset) {
    return Fail(error, "dib-image-size-exceeds-buffer");
  }
  const std::size_t stored_pixel_bytes =
      image_size == 0 ? pixel_bytes : static_cast<std::size_t>(image_size);
  if (stored_pixel_bytes > size - pixel_offset) {
    return Fail(error, "dib-image-size-exceeds-buffer");
  }
  const std::size_t pixel_end = pixel_offset + stored_pixel_bytes;
  std::size_t logical_bytes = pixel_end;
  bool has_profile = false;
  if (header_size == 124) {
    const std::uint32_t color_space = Read32(bytes, 56);
    const std::uint32_t profile_offset = Read32(bytes, 112);
    const std::uint32_t profile_size = Read32(bytes, 116);
    const bool has_profile_fields = profile_offset != 0 || profile_size != 0;
    if (has_profile_fields) {
      std::size_t profile_end = 0;
      if ((color_space != kFourCcEmbedded && color_space != kFourCcLinked) ||
          profile_offset < pixel_end || profile_size == 0 ||
          !Add(profile_offset, profile_size, &profile_end) ||
          profile_end > size || profile_end > kMaximumDibBytes) {
        return Fail(error, "dib-profile-range-invalid");
      }
      logical_bytes = std::max(logical_bytes, profile_end);
      has_profile = true;
      if (color_space == kFourCcLinked) {
        const std::uint8_t* profile = bytes + profile_offset;
        if (profile[profile_size - 1] != 0 ||
            std::find(profile, profile + profile_size - 1, 0) !=
                profile + profile_size - 1) {
          return Fail(error, "dib-linked-profile-name-invalid");
        }
      }
    } else if (color_space == kFourCcEmbedded || color_space == kFourCcLinked) {
      return Fail(error, "dib-profile-missing");
    }
  }

  DibLayout layout;
  layout.width = static_cast<std::uint32_t>(width);
  layout.height = static_cast<std::uint32_t>(height);
  layout.bits_per_pixel = bits_per_pixel;
  layout.compression = compression;
  layout.header_bytes = header_size;
  layout.pixel_offset = pixel_offset;
  layout.pixel_bytes = pixel_bytes;
  layout.logical_bytes = logical_bytes;
  layout.top_down = header_size != 12 && signed_height < 0;
  layout.has_profile = has_profile;
  *output = layout;
  return true;
}

std::optional<std::size_t> LogicalAnsiTextBytes(const std::uint8_t* bytes,
                                               std::size_t size) {
  if (bytes == nullptr || size == 0 || size > kMaximumDibBytes) {
    return std::nullopt;
  }
  const auto* terminator = std::find(bytes, bytes + size, 0);
  if (terminator == bytes + size) return std::nullopt;
  return static_cast<std::size_t>(terminator - bytes) + 1;
}

bool AnalyzeLocale(const std::uint8_t* bytes, std::size_t size,
                   std::uint32_t* locale_id) {
  if (bytes == nullptr || locale_id == nullptr || size < 4) return false;
  *locale_id = Read32(bytes, 0);
  return true;
}

bool AnalyzeDropFiles(const std::uint8_t* bytes, std::size_t size,
                      DropFilesLayout* output, std::string* error) {
  if (bytes == nullptr || output == nullptr ||
      size < kDropFilesHeaderBytes || size > kMaximumDropFilesBytes) {
    return Fail(error, "dropfiles-size-invalid");
  }
  const std::uint32_t files_offset = Read32(bytes, 0);
  if (files_offset < kDropFilesHeaderBytes || files_offset >= size) {
    return Fail(error, "dropfiles-offset-invalid");
  }
  const bool wide = Read32(bytes, 16) != 0;
  const bool non_client = Read32(bytes, 12) != 0;
  std::size_t cursor = files_offset;
  std::size_t count = 0;
  if (wide) {
    if ((files_offset & 1u) != 0) {
      return Fail(error, "dropfiles-wide-alignment-invalid");
    }
    bool saw_path_character = false;
    while (cursor + 1 < size) {
      const std::uint16_t unit = Read16(bytes, cursor);
      if (unit == 0) {
        if (!saw_path_character) {
          if (count == 0) return Fail(error, "dropfiles-list-empty");
          DropFilesLayout layout{files_offset, cursor + 2, count, true,
                                 non_client};
          *output = layout;
          return true;
        }
        ++count;
        saw_path_character = false;
      } else {
        if (unit >= 0xd800 && unit <= 0xdbff) {
          if (cursor + 3 >= size) {
            return Fail(error, "dropfiles-utf16-invalid");
          }
          const std::uint16_t low = Read16(bytes, cursor + 2);
          if (low < 0xdc00 || low > 0xdfff) {
            return Fail(error, "dropfiles-utf16-invalid");
          }
          cursor += 2;
        } else if (unit >= 0xdc00 && unit <= 0xdfff) {
          return Fail(error, "dropfiles-utf16-invalid");
        }
        saw_path_character = true;
      }
      cursor += 2;
    }
  } else {
    bool saw_path_character = false;
    while (cursor < size) {
      if (bytes[cursor++] != 0) {
        saw_path_character = true;
        continue;
      }
      if (!saw_path_character) {
        if (count == 0) return Fail(error, "dropfiles-list-empty");
        DropFilesLayout layout{files_offset, cursor, count, false, non_client};
        *output = layout;
        return true;
      }
      ++count;
      saw_path_character = false;
    }
  }
  return Fail(error, "dropfiles-list-unterminated");
}

bool BuildDropFilesWide(const std::vector<std::u16string>& paths,
                        std::vector<std::uint8_t>* output) {
  if (output == nullptr || paths.empty()) return false;
  std::size_t total_units = 1;
  const std::size_t maximum_units = kMaximumDropFilesBytes / 2;
  for (const auto& path : paths) {
    if (!ValidatePathUtf16(path) || total_units >= maximum_units ||
        path.size() > maximum_units - total_units - 1) {
      return false;
    }
    total_units += path.size() + 1;
  }
  std::size_t total_bytes = 0;
  if (!Add(kDropFilesHeaderBytes, total_units * 2, &total_bytes) ||
      total_bytes > kMaximumDropFilesBytes) {
    return false;
  }
  std::vector<std::uint8_t> bytes(total_bytes, 0);
  Write32(&bytes, 0, static_cast<std::uint32_t>(kDropFilesHeaderBytes));
  Write32(&bytes, 12, 0);
  Write32(&bytes, 16, 1);
  std::size_t cursor = kDropFilesHeaderBytes;
  for (const auto& path : paths) {
    for (const char16_t unit : path) {
      Write16(&bytes, cursor, static_cast<std::uint16_t>(unit));
      cursor += 2;
    }
    cursor += 2;
  }
  *output = std::move(bytes);
  return true;
}

}  // namespace clipboard_codecs
