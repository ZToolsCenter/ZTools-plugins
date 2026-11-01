#include "clipboard_format_equivalence.h"

#include "../common/clipboard_codecs.h"

#include <cstddef>
#include <cstdint>
#include <limits>

namespace clipboard_format_probe {
namespace {

constexpr const char* kBitmapMaterialization =
    "win32-getdibits-24bpp-top-down";

bool SameMetadata(const FormatPayload& expected,
                  const FormatPayload& actual) {
  return expected.key == actual.key &&
         expected.format_id == actual.format_id &&
         expected.native_name == actual.native_name &&
         expected.encoding == actual.encoding &&
         expected.validation_code_page == actual.validation_code_page &&
         expected.fidelity == actual.fidelity &&
         expected.source_format == actual.source_format &&
         expected.source_origin == actual.source_origin &&
         expected.materialization == actual.materialization;
}

bool IsVisibleBitmapMetadata(const FormatPayload& format) {
  return format.key == "bitmap" && format.format_id == CF_BITMAP &&
         format.native_name == L"CF_BITMAP" &&
         format.encoding == "dib24-rendered" &&
         format.fidelity == "visible-rgb-compatible" &&
         format.source_format == "CF_BITMAP" &&
         format.source_origin == "unknown" &&
         format.materialization == kBitmapMaterialization;
}

bool ReadDword(const std::vector<std::uint8_t>& bytes, std::size_t offset,
               std::uint32_t* value) {
  if (value == nullptr || offset > bytes.size() ||
      bytes.size() - offset < sizeof(std::uint32_t)) {
    return false;
  }
  *value = static_cast<std::uint32_t>(bytes[offset]) |
           (static_cast<std::uint32_t>(bytes[offset + 1]) << 8) |
           (static_cast<std::uint32_t>(bytes[offset + 2]) << 16) |
           (static_cast<std::uint32_t>(bytes[offset + 3]) << 24);
  return true;
}

bool IsComparableBitmapDib(const std::vector<std::uint8_t>& bytes,
                           clipboard_codecs::DibLayout* layout) {
  std::string error;
  std::uint32_t header_size = 0;
  std::uint32_t colors_used = 0;
  if (!ReadDword(bytes, 0, &header_size) ||
      !ReadDword(bytes, 32, &colors_used) || header_size != 40 ||
      colors_used != 0 ||
      !clipboard_codecs::AnalyzeDib(bytes.data(), bytes.size(), layout,
                                    &error)) {
    return false;
  }
  return layout->header_bytes == 40 && layout->bits_per_pixel == 24 &&
         layout->compression == BI_RGB && layout->top_down &&
         !layout->has_profile && layout->logical_bytes == bytes.size();
}

bool SameVisibleRgb(const FormatPayload& expected,
                    const FormatPayload& actual,
                    FormatComparison* comparison) {
  clipboard_codecs::DibLayout expected_layout;
  clipboard_codecs::DibLayout actual_layout;
  if (!IsComparableBitmapDib(expected.bytes, &expected_layout) ||
      !IsComparableBitmapDib(actual.bytes, &actual_layout)) {
    *comparison = FormatComparison::unconfirmed;
    return false;
  }
  if (expected_layout.width != actual_layout.width ||
      expected_layout.height != actual_layout.height) {
    *comparison = FormatComparison::mismatch;
    return false;
  }

  const std::uint64_t visible_row_bytes =
      static_cast<std::uint64_t>(expected_layout.width) * 3;
  if (visible_row_bytes > std::numeric_limits<std::size_t>::max() - 3) {
    *comparison = FormatComparison::unconfirmed;
    return false;
  }
  const std::size_t row_bytes = static_cast<std::size_t>(visible_row_bytes);
  const std::size_t stride = (row_bytes + 3) & ~std::size_t{3};
  if (expected_layout.height != 0 &&
      stride > std::numeric_limits<std::size_t>::max() /
                   expected_layout.height) {
    *comparison = FormatComparison::unconfirmed;
    return false;
  }
  const std::size_t pixel_bytes =
      stride * static_cast<std::size_t>(expected_layout.height);
  if (pixel_bytes != expected_layout.pixel_bytes ||
      pixel_bytes != actual_layout.pixel_bytes ||
      expected_layout.pixel_offset > expected.bytes.size() ||
      pixel_bytes > expected.bytes.size() - expected_layout.pixel_offset ||
      actual_layout.pixel_offset > actual.bytes.size() ||
      pixel_bytes > actual.bytes.size() - actual_layout.pixel_offset) {
    *comparison = FormatComparison::unconfirmed;
    return false;
  }

  for (std::size_t row = 0; row < expected_layout.height; ++row) {
    const std::size_t expected_offset =
        expected_layout.pixel_offset + row * stride;
    const std::size_t actual_offset = actual_layout.pixel_offset + row * stride;
    for (std::size_t column = 0; column < row_bytes; ++column) {
      if (expected.bytes[expected_offset + column] !=
          actual.bytes[actual_offset + column]) {
        *comparison = FormatComparison::mismatch;
        return false;
      }
    }
  }
  *comparison = FormatComparison::compatible;
  return true;
}

}  // namespace

FormatComparison CompareFormatRepresentations(
    const FormatPayload& expected, const FormatPayload& actual,
    FormatComparisonMode mode) {
  if (!SameMetadata(expected, actual)) return FormatComparison::mismatch;
  if (expected.bytes == actual.bytes) return FormatComparison::exact;
  if (mode != FormatComparisonMode::allow_visible_bitmap_rgb ||
      !IsVisibleBitmapMetadata(expected) ||
      !IsVisibleBitmapMetadata(actual)) {
    return FormatComparison::mismatch;
  }

  FormatComparison comparison = FormatComparison::unconfirmed;
  SameVisibleRgb(expected, actual, &comparison);
  return comparison;
}

}  // namespace clipboard_format_probe
