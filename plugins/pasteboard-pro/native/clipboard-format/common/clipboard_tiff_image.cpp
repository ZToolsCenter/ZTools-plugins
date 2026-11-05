#include "clipboard_tiff_internal.h"

#include <limits>

namespace clipboard_codecs::tiff_internal {
namespace {

bool ReadScalar(const Context& context, const Directory& directory,
                std::uint16_t tag, std::uint64_t fallback, bool required,
                bool allow_short, bool allow_long, std::uint64_t* value) {
  const Field* field = FindField(directory, tag);
  if (field == nullptr) {
    if (required) return false;
    *value = fallback;
    return true;
  }
  if (field->count != 1 ||
      (field->type == 3 && !allow_short) ||
      (field->type == 4 && !allow_long) ||
      (field->type != 3 && field->type != 4) ||
      !ReadUnsignedValue(context, *field, 0, value)) {
    return false;
  }
  return true;
}

bool ReadTagPair(const Context& context, const Directory& directory,
                 std::uint16_t first_tag, std::uint16_t second_tag,
                 const Field** first, const Field** second,
                 bool* present) {
  *first = FindField(directory, first_tag);
  *second = FindField(directory, second_tag);
  *present = *first != nullptr || *second != nullptr;
  if (!*present) return true;
  if (*first == nullptr || *second == nullptr ||
      ((*first)->type != 3 && (*first)->type != 4) ||
      ((*second)->type != 3 && (*second)->type != 4) ||
      (*first)->count != (*second)->count) {
    return false;
  }
  (void)context;
  return true;
}

bool AddRange(Context* context, std::uint64_t offset, std::uint64_t length) {
  if (length == 0 || offset < 8) {
    return context->Fail("TIFF image data range is empty or points into header");
  }
  return context->Include(offset, length);
}

bool ValidateRangeArray(Context* context, const Field& offsets,
                        const Field& byte_counts,
                        std::uint64_t expected_count, bool enforce_expected) {
  if (offsets.count != byte_counts.count ||
      (enforce_expected && offsets.count != expected_count)) {
    return context->Fail("TIFF offset and byte-count arrays have invalid lengths");
  }
  for (std::uint32_t index = 0; index < offsets.count; ++index) {
    std::uint64_t offset = 0;
    std::uint64_t byte_count = 0;
    if (!ReadUnsignedValue(*context, offsets, index, &offset) ||
        !ReadUnsignedValue(*context, byte_counts, index, &byte_count) ||
        !AddRange(context, offset, byte_count)) {
      if (context->error.empty()) {
        context->Fail("TIFF image offset or byte count is unreadable");
      }
      return false;
    }
  }
  return true;
}

bool ValidateFreeRanges(Context* context, const Directory& directory) {
  const Field* offsets = FindField(directory, 288);
  const Field* counts = FindField(directory, 289);
  if (offsets == nullptr && counts == nullptr) return true;
  if (offsets == nullptr || counts == nullptr || offsets->type != 4 ||
      counts->type != 4 || offsets->count != counts->count) {
    return context->Fail("TIFF free-data offset and count arrays are malformed");
  }
  for (std::uint32_t index = 0; index < offsets->count; ++index) {
    std::uint64_t offset = 0;
    std::uint64_t count = 0;
    if (!ReadUnsignedValue(*context, *offsets, index, &offset) ||
        !ReadUnsignedValue(*context, *counts, index, &count)) {
      return context->Fail("TIFF free-data range is unreadable");
    }
    if (count == 0) continue;
    if (!AddRange(context, offset, count)) return false;
  }
  return true;
}

bool ValidateJpegRange(Context* context, const Directory& directory,
                       bool require_data) {
  const Field* offset_field = FindField(directory, 513);
  const Field* length_field = FindField(directory, 514);
  if (offset_field == nullptr && length_field == nullptr) {
    if (require_data) {
      return context->Fail("TIFF image data is missing");
    }
    return true;
  }
  if (offset_field == nullptr || length_field == nullptr ||
      offset_field->type != 4 || length_field->type != 4 ||
      offset_field->count != 1 || length_field->count != 1) {
    return context->Fail("TIFF JPEG interchange range is malformed");
  }
  std::uint64_t offset = 0;
  std::uint64_t length = 0;
  if (!ReadUnsignedValue(*context, *offset_field, 0, &offset) ||
      !ReadUnsignedValue(*context, *length_field, 0, &length)) {
    return context->Fail("TIFF JPEG interchange range is unreadable");
  }
  if (offset == 0 && length == 0) {
    return require_data
               ? context->Fail("TIFF JPEG interchange image range is empty")
               : true;
  }
  if (offset == 0 || length == 0) {
    return context->Fail("TIFF JPEG interchange range is partially empty");
  }
  return AddRange(context, offset, length);
}

bool ValidateJpegTables(Context* context, const Directory& directory) {
  const Field* quantization = FindField(directory, 519);
  const Field* dc_tables = FindField(directory, 520);
  const Field* ac_tables = FindField(directory, 521);
  if (quantization == nullptr && dc_tables == nullptr && ac_tables == nullptr) {
    return true;
  }

  std::uint64_t samples = 1;
  if (!ReadScalar(*context, directory, 277, 1, false, true, false, &samples) ||
      samples == 0 || samples > UINT32_MAX) {
    return context->Fail("TIFF JPEG table sample count is invalid");
  }
  const Field* table_fields[] = {quantization, dc_tables, ac_tables};
  for (std::size_t table_kind = 0; table_kind < 3; ++table_kind) {
    const Field* field = table_fields[table_kind];
    if (field == nullptr) continue;
    if (field->type != 4 || field->count != samples) {
      return context->Fail("TIFF JPEG table offset array is malformed");
    }
    for (std::uint32_t index = 0; index < field->count; ++index) {
      std::uint64_t offset = 0;
      if (!ReadUnsignedValue(*context, *field, index, &offset)) {
        return context->Fail("TIFF JPEG table offset is unreadable");
      }
      if (table_kind == 0) {
        if (!AddRange(context, offset, 64)) return false;
        continue;
      }

      if (offset < 8 || !context->IsRange(offset, 16)) {
        return context->Fail("TIFF JPEG Huffman table header is truncated");
      }
      std::uint64_t symbol_count = 0;
      for (std::uint64_t bit_count = 0; bit_count < 16; ++bit_count) {
        symbol_count += context->bytes[static_cast<std::size_t>(offset + bit_count)];
      }
      if (symbol_count > 256) {
        return context->Fail("TIFF JPEG Huffman table has too many symbols");
      }
      if (!AddRange(context, offset, 16 + symbol_count)) return false;
    }
  }
  return true;
}

bool EstimateNativeBytesPerPixel(Context* context,
                                 const Directory& directory,
                                 std::uint64_t samples_per_pixel,
                                 std::uint64_t* bytes_per_pixel) {
  if (bytes_per_pixel == nullptr) {
    return context->Fail("TIFF native sample output is required");
  }
  const Field* bits = FindField(directory, 258);
  if (bits == nullptr) {
    *bytes_per_pixel = samples_per_pixel;
    return true;
  }
  if (bits->type != 3 || bits->count != samples_per_pixel) {
    return context->Fail("TIFF BitsPerSample count or type is invalid");
  }

  std::uint64_t total = 0;
  for (std::uint32_t index = 0; index < bits->count; ++index) {
    std::uint64_t value = 0;
    if (!ReadUnsignedValue(*context, *bits, index, &value) || value == 0) {
      return context->Fail("TIFF BitsPerSample must be a positive SHORT");
    }
    const std::uint64_t sample_bytes = (value + 7) / 8;
    if (sample_bytes > UINT64_MAX - total) {
      return context->Fail("TIFF native sample byte stride overflows");
    }
    total += sample_bytes;
  }
  *bytes_per_pixel = total;
  return true;
}

bool ValidateSampleFormat(Context* context, const Directory& directory,
                          std::uint64_t samples_per_pixel) {
  const Field* format = FindField(directory, 339);
  if (format == nullptr) return true;
  if (format->type != 3 || format->count != samples_per_pixel) {
    return context->Fail("TIFF SampleFormat count or type is invalid");
  }
  for (std::uint32_t index = 0; index < format->count; ++index) {
    std::uint64_t value = 0;
    if (!ReadUnsignedValue(*context, *format, index, &value) ||
        value < 1 || value > 4) {
      return context->Fail("TIFF SampleFormat value is invalid");
    }
  }
  return true;
}

bool ExpectedStrips(Context* context, const Directory& directory,
                    std::uint32_t height, std::uint64_t samples_per_pixel,
                    std::uint64_t planar_configuration,
                    std::uint64_t* expected) {
  std::uint64_t rows_per_strip = 0;
  if (!ReadScalar(*context, directory, 278, UINT32_MAX, false, true, true,
                  &rows_per_strip) ||
      rows_per_strip == 0) {
    return context->Fail("TIFF RowsPerStrip is invalid");
  }
  const std::uint64_t strips =
      (static_cast<std::uint64_t>(height) + rows_per_strip - 1) /
      rows_per_strip;
  const std::uint64_t planes = planar_configuration == 2
                                   ? samples_per_pixel
                                   : 1;
  if (strips != 0 &&
      planes > std::numeric_limits<std::uint64_t>::max() / strips) {
    return context->Fail("TIFF strip count overflows");
  }
  *expected = strips * planes;
  return true;
}

bool ExpectedTiles(Context* context, const Directory& directory,
                   std::uint32_t width, std::uint32_t height,
                   std::uint64_t samples_per_pixel,
                   std::uint64_t planar_configuration,
                   std::uint64_t* expected) {
  std::uint64_t tile_width = 0;
  std::uint64_t tile_height = 0;
  if (!ReadScalar(*context, directory, 322, 0, true, true, true, &tile_width) ||
      !ReadScalar(*context, directory, 323, 0, true, true, true, &tile_height) ||
      tile_width == 0 || tile_height == 0 ||
      tile_width > UINT32_MAX || tile_height > UINT32_MAX) {
    return context->Fail("TIFF tile dimensions are invalid");
  }
  const std::uint64_t across =
      (static_cast<std::uint64_t>(width) + tile_width - 1) / tile_width;
  const std::uint64_t down =
      (static_cast<std::uint64_t>(height) + tile_height - 1) / tile_height;
  const std::uint64_t planes = planar_configuration == 2
                                   ? samples_per_pixel
                                   : 1;
  if (across != 0 && down > UINT64_MAX / across) {
    return context->Fail("TIFF tile stride overflows");
  }
  const std::uint64_t tile_count = across * down;
  if (tile_count != 0 && planes > UINT64_MAX / tile_count) {
    return context->Fail("TIFF planar tile count overflows");
  }
  *expected = tile_count * planes;
  return true;
}

}  // namespace

bool ValidateImageDirectory(Context* context, const Directory& directory,
                            bool require_image, TiffFrameLayout* frame,
                            std::uint64_t* native_expanded_bytes) {
  if (context == nullptr) return false;
  if (native_expanded_bytes != nullptr) *native_expanded_bytes = 0;
  if (!ValidateJpegTables(context, directory)) return false;
  std::uint64_t compression = 1;
  if (!ReadScalar(*context, directory, 259, 1, false, true, false,
                  &compression)) {
    return context->Fail("TIFF Compression must be one SHORT value");
  }
  (void)compression;

  const Field* strip_offsets = nullptr;
  const Field* strip_counts = nullptr;
  bool has_strips = false;
  if (!ReadTagPair(*context, directory, 273, 279, &strip_offsets,
                   &strip_counts, &has_strips)) {
    return context->Fail("TIFF strip offset and count arrays are malformed");
  }

  const Field* tile_offsets = nullptr;
  const Field* tile_counts = nullptr;
  bool has_tiles = false;
  if (!ReadTagPair(*context, directory, 324, 325, &tile_offsets,
                   &tile_counts, &has_tiles)) {
    return context->Fail("TIFF tile offset and count arrays are malformed");
  }
  if (has_strips && has_tiles) {
    return context->Fail("TIFF IFD mixes strip and tile data layouts");
  }
  if (has_tiles && tile_offsets->type != 4) {
    return context->Fail("TIFF TileOffsets must use LONG values");
  }

  if (!ValidateFreeRanges(context, directory)) return false;
  if (!ValidateJpegRange(context, directory, require_image &&
                                                !has_strips && !has_tiles)) {
    return false;
  }

  std::uint64_t width_value = 0;
  std::uint64_t height_value = 0;
  std::uint64_t samples = 1;
  std::uint64_t planar = 1;
  std::uint64_t expected_ranges = 0;
  std::uint64_t pixel_count = 0;
  std::uint64_t decoded_bytes = 0;
  std::uint64_t native_bytes_per_pixel = 0;
  std::uint64_t native_bytes = 0;

  if (require_image) {
    std::uint64_t photometric = 0;
    if (!ReadScalar(*context, directory, 262, 0, true, true, false,
                    &photometric)) {
      return context->Fail(
          "TIFF PhotometricInterpretation must be one SHORT value");
    }
    (void)photometric;
    if (!ReadScalar(*context, directory, 256, 0, true, true, true,
                        &width_value) ||
        !ReadScalar(*context, directory, 257, 0, true, true, true,
                    &height_value) ||
        width_value == 0 || height_value == 0 ||
        width_value > kMaximumTiffSide ||
        height_value > kMaximumTiffSide) {
      return context->Fail("TIFF image dimensions are invalid or too large");
    }
    if (width_value > UINT64_MAX / height_value) {
      return context->Fail("TIFF image pixel stride overflows");
    }
    pixel_count = width_value * height_value;
    if (pixel_count > kMaximumTiffPixels) {
      return context->Fail("TIFF image pixel budget is exceeded");
    }
    if (pixel_count > UINT64_MAX / 4) {
      return context->Fail("TIFF RGBA32 expansion size overflows");
    }
    decoded_bytes = pixel_count * 4;

    if (!ReadScalar(*context, directory, 277, 1, false, true, false, &samples) ||
        samples == 0 ||
        !ReadScalar(*context, directory, 284, 1, false, true, false,
                        &planar) ||
        (planar != 1 && planar != 2) ||
        !EstimateNativeBytesPerPixel(context, directory, samples,
                                     &native_bytes_per_pixel) ||
        !ValidateSampleFormat(context, directory, samples)) {
      if (context->error.empty()) {
        context->Fail("TIFF sample layout is invalid");
      }
      return false;
    }
    if (native_bytes_per_pixel != 0 &&
        pixel_count > UINT64_MAX / native_bytes_per_pixel) {
      return context->Fail("TIFF native sample expansion size overflows");
    }
    native_bytes = pixel_count * native_bytes_per_pixel;

    if (has_strips) {
      if (!ExpectedStrips(context, directory,
                          static_cast<std::uint32_t>(height_value), samples,
                          planar, &expected_ranges)) {
        return false;
      }
    } else if (has_tiles) {
      if (!ExpectedTiles(context, directory,
                         static_cast<std::uint32_t>(width_value),
                         static_cast<std::uint32_t>(height_value), samples,
                         planar, &expected_ranges)) {
        return false;
      }
    } else if (FindField(directory, 513) == nullptr ||
               FindField(directory, 514) == nullptr) {
      return context->Fail("TIFF image has no strip, tile, or JPEG data range");
    }
  }

  if (has_strips &&
      !ValidateRangeArray(context, *strip_offsets, *strip_counts,
                          expected_ranges, require_image)) {
    return false;
  }
  if (has_tiles &&
      !ValidateRangeArray(context, *tile_offsets, *tile_counts,
                          expected_ranges, require_image)) {
    return false;
  }

  if (require_image && frame != nullptr) {
    frame->width = static_cast<std::uint32_t>(width_value);
    frame->height = static_cast<std::uint32_t>(height_value);
    frame->decoded_bytes = decoded_bytes;
  }
  if (require_image && native_expanded_bytes != nullptr) {
    *native_expanded_bytes = native_bytes;
  }
  return true;
}

}  // namespace clipboard_codecs::tiff_internal
