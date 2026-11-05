#include "tiff_case_builder.h"
#include "clipboard_tiff.h"

#include <cstdint>
#include <iostream>
#include <string>
#include <vector>

namespace {

using clipboard_codecs::TiffLayout;
using clipboard_codecs::AnalyzeTiff;
using clipboard_codecs::tiff_test::AddRasterDirectory;
using clipboard_codecs::tiff_test::RasterOptions;
using clipboard_codecs::tiff_test::TiffBuilder;

struct TestRunner {
  int failed = 0;

  void Check(bool condition, const char* id) {
    std::cout << (condition ? "PASS " : "FAIL ") << id << '\n';
    if (!condition) ++failed;
  }
};

void Put16(std::vector<std::uint8_t>* bytes, std::size_t offset,
           std::uint16_t value) {
  (*bytes)[offset] = static_cast<std::uint8_t>(value);
  (*bytes)[offset + 1] = static_cast<std::uint8_t>(value >> 8);
}

void Put32(std::vector<std::uint8_t>* bytes, std::size_t offset,
           std::uint32_t value) {
  for (std::size_t index = 0; index < 4; ++index) {
    (*bytes)[offset + index] =
        static_cast<std::uint8_t>((value >> (index * 8)) & 0xff);
  }
}

bool RejectIfdTypeForScalar(std::uint16_t tag) {
  TiffBuilder builder;
  const int data = builder.AddImageData({0x35});
  const int page =
      AddRasterDirectory(&builder, RasterOptions{}, {data}, {1});
  auto bytes = builder.Build(page);
  const std::uint64_t entry = builder.EntryOffset(page, tag);
  if (entry == UINT64_MAX) return false;
  Put16(&bytes, static_cast<std::size_t>(entry + 2), 13);
  TiffLayout layout;
  return !AnalyzeTiff(bytes.data(), bytes.size(), &layout);
}

bool RejectIfdTypeForPointer(std::uint16_t tag) {
  TiffBuilder builder;
  const int data = builder.AddImageData({0x36});
  const int page = AddRasterDirectory(&builder, RasterOptions{}, {data}, {1});
  const int metadata = builder.AddDirectory();
  builder.AddBytes(metadata, 270, 2, {'m', 0});
  builder.AddDirectoryReferences(page, tag, 13, {metadata});
  auto bytes = builder.Build(page);
  TiffLayout layout;
  return !AnalyzeTiff(bytes.data(), bytes.size(), &layout);
}

std::vector<std::uint8_t> NativeSampleImage(std::uint32_t samples) {
  TiffBuilder builder;
  const int data = builder.AddImageData({0x38});
  RasterOptions options;
  options.width = 4096;
  options.height = 2048;
  options.samples_per_pixel = samples;
  options.photometric_interpretation = 2;
  options.extra_samples = std::vector<std::uint32_t>(samples - 3, 0);
  if (samples == 4) options.extra_samples[0] = 2;
  options.bits_per_sample = std::vector<std::uint32_t>(samples, 64);
  const int page = AddRasterDirectory(&builder, options, {data}, {1});
  return builder.Build(page);
}

bool HasAscendingTags(const std::vector<std::uint8_t>& bytes,
                      std::uint32_t ifd_offset) {
  if (ifd_offset > bytes.size() || bytes.size() - ifd_offset < 2) return false;
  const std::uint16_t count = static_cast<std::uint16_t>(
      bytes[ifd_offset] | (static_cast<std::uint16_t>(bytes[ifd_offset + 1]) << 8));
  const std::uint64_t directory_bytes = 2ull + 12ull * count + 4;
  if (directory_bytes > bytes.size() - ifd_offset) return false;
  std::uint16_t previous = 0;
  for (std::uint16_t index = 0; index < count; ++index) {
    const std::size_t entry = ifd_offset + 2 + index * 12;
    const std::uint16_t tag = static_cast<std::uint16_t>(
        bytes[entry] | (static_cast<std::uint16_t>(bytes[entry + 1]) << 8));
    if (index != 0 && tag <= previous) return false;
    previous = tag;
  }
  return true;
}

}  // namespace

int RunTiffReferenceCases() {
  TestRunner tests;
  TiffLayout layout;

  tests.Check(RejectIfdTypeForScalar(256),
              "tiff-ifd-type-not-allowed-for-width");
  tests.Check(RejectIfdTypeForScalar(257),
              "tiff-ifd-type-not-allowed-for-height");
  tests.Check(RejectIfdTypeForScalar(277),
              "tiff-ifd-type-not-allowed-for-samples-per-pixel");
  tests.Check(RejectIfdTypeForPointer(34665),
              "tiff-ifd-type13-not-allowed-for-exif-pointer");
  tests.Check(RejectIfdTypeForPointer(34853),
              "tiff-ifd-type13-not-allowed-for-gps-pointer");
  tests.Check(RejectIfdTypeForPointer(40965),
              "tiff-ifd-type13-not-allowed-for-interop-pointer");

  TiffBuilder sorted_fixture_builder;
  const int sorted_data = sorted_fixture_builder.AddImageData({0x37});
  const int sorted_page = AddRasterDirectory(
      &sorted_fixture_builder, RasterOptions{}, {sorted_data}, {1});
  auto sorted_fixture = sorted_fixture_builder.Build(sorted_page);
  tests.Check(HasAscendingTags(sorted_fixture,
                               sorted_fixture_builder.IfdOffset(sorted_page)),
              "tiff-fixture-ifd-fields-sorted-by-tag");

  TiffBuilder six_bit_builder;
  const int six_bit_data = six_bit_builder.AddImageData({0x39});
  RasterOptions six_bit_options;
  six_bit_options.photometric_interpretation = 1;
  six_bit_options.bits_per_sample = {6};
  const int six_bit_page = AddRasterDirectory(
      &six_bit_builder, six_bit_options, {six_bit_data}, {1});
  auto six_bit = six_bit_builder.Build(six_bit_page);
  tests.Check(AnalyzeTiff(six_bit.data(), six_bit.size(), &layout) &&
                  layout.frames[0].decoded_bytes == 4,
              "tiff-six-bit-short-sample-accepted");

  auto native_exact = NativeSampleImage(4);
  std::string native_error;
  const bool native_exact_valid =
      AnalyzeTiff(native_exact.data(), native_exact.size(), &layout,
                  &native_error);
  tests.Check(native_exact_valid &&
                  layout.decoded_bytes == 4096ull * 2048ull * 4,
              "tiff-native-sample-budget-exact-boundary");
  if (!native_exact_valid) std::cerr << "native budget fixture: " << native_error << '\n';
  auto native_over = NativeSampleImage(5);
  tests.Check(!AnalyzeTiff(native_over.data(), native_over.size(), &layout),
              "tiff-native-sample-budget-over-boundary-rejected");

  TiffBuilder missing_photo_builder;
  const int missing_photo_data = missing_photo_builder.AddImageData({0x40});
  RasterOptions missing_photo_options;
  missing_photo_options.include_photometric = false;
  const int missing_photo_page = AddRasterDirectory(
      &missing_photo_builder, missing_photo_options,
      {missing_photo_data}, {1});
  auto missing_photo = missing_photo_builder.Build(missing_photo_page);
  tests.Check(!AnalyzeTiff(missing_photo.data(), missing_photo.size(), &layout),
              "tiff-main-photometric-interpretation-required");

  TiffBuilder bad_photo_type_builder;
  const int bad_photo_data = bad_photo_type_builder.AddImageData({0x41});
  const int bad_photo_page = AddRasterDirectory(
      &bad_photo_type_builder, RasterOptions{}, {bad_photo_data}, {1});
  auto bad_photo_type = bad_photo_type_builder.Build(bad_photo_page);
  Put16(&bad_photo_type,
        static_cast<std::size_t>(bad_photo_type_builder.EntryOffset(
            bad_photo_page, 262) + 2),
        4);
  tests.Check(!AnalyzeTiff(bad_photo_type.data(), bad_photo_type.size(),
                           &layout),
              "tiff-photometric-long-type-rejected");

  TiffBuilder bad_photo_count_builder;
  const int bad_photo_count_data =
      bad_photo_count_builder.AddImageData({0x42});
  const int bad_photo_count_page = AddRasterDirectory(
      &bad_photo_count_builder, RasterOptions{}, {bad_photo_count_data}, {1});
  auto bad_photo_count = bad_photo_count_builder.Build(bad_photo_count_page);
  Put32(&bad_photo_count,
        static_cast<std::size_t>(bad_photo_count_builder.EntryOffset(
            bad_photo_count_page, 262) + 4),
        2);
  tests.Check(!AnalyzeTiff(bad_photo_count.data(), bad_photo_count.size(),
                           &layout),
              "tiff-photometric-count-two-rejected");

  TiffBuilder default_compression_builder;
  const int default_compression_data =
      default_compression_builder.AddImageData({0x43});
  RasterOptions default_compression_options;
  default_compression_options.include_compression = false;
  const int default_compression_page = AddRasterDirectory(
      &default_compression_builder, default_compression_options,
      {default_compression_data}, {1});
  auto default_compression =
      default_compression_builder.Build(default_compression_page);
  tests.Check(AnalyzeTiff(default_compression.data(),
                          default_compression.size(), &layout),
              "tiff-absent-compression-uses-default-one");

  TiffBuilder bad_compression_builder;
  const int bad_compression_data =
      bad_compression_builder.AddImageData({0x44});
  const int bad_compression_page = AddRasterDirectory(
      &bad_compression_builder, RasterOptions{}, {bad_compression_data}, {1});
  auto bad_compression = bad_compression_builder.Build(bad_compression_page);
  Put16(&bad_compression,
        static_cast<std::size_t>(bad_compression_builder.EntryOffset(
            bad_compression_page, 259) + 2),
        4);
  tests.Check(!AnalyzeTiff(bad_compression.data(), bad_compression.size(),
                           &layout),
              "tiff-compression-long-type-rejected");

  auto bad_compression_count = bad_compression_builder.Build(bad_compression_page);
  Put32(&bad_compression_count,
        static_cast<std::size_t>(bad_compression_builder.EntryOffset(
            bad_compression_page, 259) + 4),
        2);
  tests.Check(!AnalyzeTiff(bad_compression_count.data(),
                           bad_compression_count.size(), &layout),
              "tiff-compression-count-two-rejected");

  TiffBuilder subifd_builder;
  const int subifd_data = subifd_builder.AddImageData({0x11});
  const int subifd_root = AddRasterDirectory(
      &subifd_builder, RasterOptions{}, {subifd_data}, {1});
  const int subifd_child = subifd_builder.AddDirectory();
  subifd_builder.AddBytes(subifd_child, 270, 2, {'s', 0});
  subifd_builder.AddDirectoryReferences(subifd_root, 330, 13, {subifd_child});
  auto subifd = subifd_builder.Build(subifd_root);
  const std::uint64_t ascii_entry =
      subifd_builder.EntryOffset(subifd_child, 270);
  tests.Check(ascii_entry != UINT64_MAX &&
                  subifd[ascii_entry + 8] == 's' &&
                  subifd[ascii_entry + 9] == 0,
              "tiff-fixture-ascii-value-nul-terminated");
  tests.Check(AnalyzeTiff(subifd.data(), subifd.size(), &layout) &&
                  layout.frames.size() == 1,
              "tiff-ifd-type-valid-for-subifd-pointer");

  TiffBuilder shared_ifd_builder;
  const int shared_ifd_data = shared_ifd_builder.AddImageData({0x12});
  const int shared_ifd_root = AddRasterDirectory(
      &shared_ifd_builder, RasterOptions{}, {shared_ifd_data}, {1});
  const int shared_ifd_child = shared_ifd_builder.AddDirectory();
  shared_ifd_builder.AddBytes(shared_ifd_child, 270, 2, {'s', 0});
  shared_ifd_builder.AddDirectoryReferences(
      shared_ifd_root, 330, 4, {shared_ifd_child, shared_ifd_child});
  auto shared_ifd = shared_ifd_builder.Build(shared_ifd_root);
  tests.Check(AnalyzeTiff(shared_ifd.data(), shared_ifd.size(), &layout),
              "tiff-shared-ifd-target-is-not-a-cycle");

  TiffBuilder short_rows_builder;
  const int short_rows_data = short_rows_builder.AddImageData({0x21, 0x22});
  RasterOptions short_rows_options;
  short_rows_options.width = 1;
  short_rows_options.height = 2;
  short_rows_options.rows_per_strip = 1;
  const int short_rows_page = AddRasterDirectory(
      &short_rows_builder, short_rows_options,
      {short_rows_data, short_rows_data}, {2, 2});
  auto short_rows = short_rows_builder.Build(short_rows_page);
  Put16(&short_rows,
        static_cast<std::size_t>(short_rows_builder.EntryOffset(
            short_rows_page, 278) + 2),
        3);
  tests.Check(AnalyzeTiff(short_rows.data(), short_rows.size(), &layout),
              "tiff-rows-per-strip-short-type-accepted");

  TiffBuilder bad_tile_offset_type_builder;
  const int bad_tile_data = bad_tile_offset_type_builder.AddImageData({0x31});
  RasterOptions bad_tile_options;
  bad_tile_options.tiled = true;
  const int bad_tile_page = AddRasterDirectory(
      &bad_tile_offset_type_builder, bad_tile_options, {bad_tile_data}, {1});
  auto bad_tile_type = bad_tile_offset_type_builder.Build(bad_tile_page);
  Put16(&bad_tile_type,
        static_cast<std::size_t>(bad_tile_offset_type_builder.EntryOffset(
            bad_tile_page, 324) + 2),
        3);
  tests.Check(!AnalyzeTiff(bad_tile_type.data(), bad_tile_type.size(), &layout),
              "tiff-tile-offsets-short-type-rejected");

  TiffBuilder short_strip_builder;
  const int short_strip_data = short_strip_builder.AddImageData({0x21, 0x22});
  const int short_strip_page = AddRasterDirectory(
      &short_strip_builder, RasterOptions{}, {short_strip_data}, {2});
  auto short_strip = short_strip_builder.Build(short_strip_page);
  Put16(&short_strip,
        static_cast<std::size_t>(short_strip_builder.EntryOffset(
            short_strip_page, 273) + 2),
        3);
  Put16(&short_strip,
        static_cast<std::size_t>(short_strip_builder.EntryOffset(
            short_strip_page, 279) + 2),
        3);
  tests.Check(AnalyzeTiff(short_strip.data(), short_strip.size(), &layout),
              "tiff-short-strip-offsets-and-bytecounts-accepted");

  TiffBuilder short_tile_count_builder;
  const int short_tile_data = short_tile_count_builder.AddImageData({0x22});
  RasterOptions short_tile_options;
  short_tile_options.tiled = true;
  const int short_tile_page = AddRasterDirectory(
      &short_tile_count_builder, short_tile_options, {short_tile_data}, {1});
  auto short_tile_count = short_tile_count_builder.Build(short_tile_page);
  Put16(&short_tile_count,
        static_cast<std::size_t>(short_tile_count_builder.EntryOffset(
            short_tile_page, 325) + 2),
        3);
  tests.Check(AnalyzeTiff(short_tile_count.data(), short_tile_count.size(),
                          &layout),
              "tiff-short-tile-bytecount-type-accepted");

  TiffBuilder thumbnail_builder;
  const int image = thumbnail_builder.AddImageData({0x31, 0x32});
  const int thumbnail =
      thumbnail_builder.AddImageData({0xff, 0xd8, 0xff, 0xd9});
  const int thumbnail_page = AddRasterDirectory(
      &thumbnail_builder, RasterOptions{}, {image}, {2});
  thumbnail_builder.AddImageOffsets(thumbnail_page, 513, 4, {thumbnail});
  thumbnail_builder.AddNumbers(thumbnail_page, 514, 4, {4});
  auto thumbnail_bytes = thumbnail_builder.Build(thumbnail_page);
  tests.Check(AnalyzeTiff(thumbnail_bytes.data(), thumbnail_bytes.size(),
                          &layout) &&
                  layout.logical_bytes == thumbnail_bytes.size(),
              "tiff-jpeg-interchange-thumbnail-range-included");

  auto broken_thumbnail = thumbnail_bytes;
  const std::uint64_t thumbnail_entry =
      thumbnail_builder.EntryOffset(thumbnail_page, 513);
  const auto invalid_thumbnail_offset =
      static_cast<std::uint32_t>(broken_thumbnail.size() + 20);
  for (std::size_t byte = 0; byte < 4; ++byte) {
    broken_thumbnail[thumbnail_entry + 8 + byte] =
        static_cast<std::uint8_t>((invalid_thumbnail_offset >> (byte * 8)) &
                                  0xff);
  }
  tests.Check(!AnalyzeTiff(broken_thumbnail.data(), broken_thumbnail.size(),
                           &layout),
              "tiff-jpeg-interchange-thumbnail-range-bounded");

  TiffBuilder tables_builder;
  const int image_data = tables_builder.AddImageData({0x31});
  const int quantization = tables_builder.AddImageData(
      std::vector<std::uint8_t>(64, 0x01));
  std::vector<std::uint8_t> dc(17, 0);
  dc[0] = 1;
  dc[16] = 0x05;
  const int dc_table = tables_builder.AddImageData(dc);
  std::vector<std::uint8_t> ac(18, 0);
  ac[1] = 2;
  ac[16] = 0x01;
  ac[17] = 0x02;
  const int ac_table = tables_builder.AddImageData(ac);
  RasterOptions jpeg;
  jpeg.compression = 7;
  const int jpeg_page =
      AddRasterDirectory(&tables_builder, jpeg, {image_data}, {1});
  tables_builder.AddImageOffsets(jpeg_page, 519, 4, {quantization});
  tables_builder.AddImageOffsets(jpeg_page, 520, 4, {dc_table});
  tables_builder.AddImageOffsets(jpeg_page, 521, 4, {ac_table});
  auto jpeg_tables = tables_builder.Build(jpeg_page);
  tests.Check(AnalyzeTiff(jpeg_tables.data(), jpeg_tables.size(), &layout) &&
                  layout.logical_bytes == jpeg_tables.size(),
              "tiff-jpeg-quantization-and-huffman-ranges-included");

  auto invalid_jpeg_table = jpeg_tables;
  const std::uint64_t quantization_entry =
      tables_builder.EntryOffset(jpeg_page, 519);
  const std::uint32_t invalid_table_offset =
      static_cast<std::uint32_t>(invalid_jpeg_table.size() + 64);
  for (std::size_t byte = 0; byte < 4; ++byte) {
    invalid_jpeg_table[quantization_entry + 8 + byte] =
        static_cast<std::uint8_t>((invalid_table_offset >> (byte * 8)) &
                                  0xff);
  }
  tests.Check(!AnalyzeTiff(invalid_jpeg_table.data(),
                          invalid_jpeg_table.size(), &layout),
              "tiff-jpeg-table-offset-range-bounded");

  TiffBuilder free_range_builder;
  const int image_range = free_range_builder.AddImageData({0x41});
  const int free_range = free_range_builder.AddImageData({0x51, 0x52, 0x53});
  const int free_page = AddRasterDirectory(
      &free_range_builder, RasterOptions{}, {image_range}, {1});
  free_range_builder.AddImageOffsets(free_page, 288, 4, {free_range});
  free_range_builder.AddNumbers(free_page, 289, 4, {3});
  auto free_ranges = free_range_builder.Build(free_page);
  tests.Check(AnalyzeTiff(free_ranges.data(), free_ranges.size(), &layout) &&
                  layout.logical_bytes == free_ranges.size(),
              "tiff-free-offset-and-bytecount-range-included");

  TiffBuilder compressed_builder;
  const int compressed_data = compressed_builder.AddImageData({0x7f, 0x00});
  RasterOptions lzw;
  lzw.compression = 5;
  const int compressed_page =
      AddRasterDirectory(&compressed_builder, lzw, {compressed_data}, {2});
  auto compressed = compressed_builder.Build(compressed_page);
  tests.Check(AnalyzeTiff(compressed.data(), compressed.size(), &layout),
              "tiff-compressed-image-structure-is-not-uncompressed-only");

  return tests.failed;
}
