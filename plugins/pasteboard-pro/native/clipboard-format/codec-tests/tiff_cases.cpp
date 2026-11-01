#include "tiff_cases.h"

#include "tiff_case_builder.h"
#include "clipboard_tiff.h"

#include <algorithm>
#include <cstdint>
#include <iostream>
#include <limits>
#include <string>
#include <vector>

int RunTiffReferenceCases();

using namespace clipboard_codecs;

namespace {

using tiff_test::AddRasterDirectory;
using tiff_test::RasterOptions;
using tiff_test::TiffBuilder;

struct TestRunner {
  int failed = 0;

  void Check(bool condition, const char* id) {
    std::cout << (condition ? "PASS " : "FAIL ") << id << '\n';
    if (!condition) ++failed;
  }
};

void Put16(std::vector<std::uint8_t>* bytes, std::size_t offset,
           std::uint16_t value, bool big_endian = false) {
  if (big_endian) {
    (*bytes)[offset] = static_cast<std::uint8_t>(value >> 8);
    (*bytes)[offset + 1] = static_cast<std::uint8_t>(value);
  } else {
    (*bytes)[offset] = static_cast<std::uint8_t>(value);
    (*bytes)[offset + 1] = static_cast<std::uint8_t>(value >> 8);
  }
}

void Put32(std::vector<std::uint8_t>* bytes, std::size_t offset,
           std::uint32_t value, bool big_endian = false) {
  for (std::size_t byte = 0; byte < 4; ++byte) {
    const std::size_t shift = big_endian ? (3 - byte) * 8 : byte * 8;
    (*bytes)[offset + byte] =
        static_cast<std::uint8_t>((value >> shift) & 0xff);
  }
}

std::vector<std::uint8_t> OnePage(RasterOptions options = {},
                                  std::uint32_t payload_bytes = 8) {
  TiffBuilder builder;
  const int data = builder.AddImageData(
      std::vector<std::uint8_t>(payload_bytes, 0x4a));
  AddRasterDirectory(&builder, options, {data}, {payload_bytes});
  return builder.Build();
}

bool Analyze(const std::vector<std::uint8_t>& bytes, TiffLayout* layout,
             std::string* error = nullptr) {
  return AnalyzeTiff(bytes.data(), bytes.size(), layout, error);
}

void AddMetadata(TiffBuilder* builder, int directory,
                 std::uint8_t marker = 'm') {
  builder->AddBytes(directory, 270, 2, {marker, 0});
}

std::vector<std::uint8_t> MakeNodeGraph(std::size_t total_nodes) {
  TiffBuilder builder;
  const int data = builder.AddImageData({0x42});
  RasterOptions options;
  const int root = AddRasterDirectory(&builder, options, {data}, {1});
  std::vector<int> children;
  for (std::size_t index = 1; index < total_nodes; ++index) {
    const int child = builder.AddDirectory();
    AddMetadata(&builder, child, static_cast<std::uint8_t>('a' + index % 26));
    children.push_back(child);
  }
  if (!children.empty()) {
    builder.AddDirectoryReferences(root, 330, 4, children);
  }
  return builder.Build(root);
}

std::vector<std::uint8_t> MakeDepthGraph(std::size_t total_nodes) {
  TiffBuilder builder;
  const int data = builder.AddImageData({0x42});
  RasterOptions options;
  const int root = AddRasterDirectory(&builder, options, {data}, {1});
  std::vector<int> nodes;
  for (std::size_t index = 1; index < total_nodes; ++index) {
    const int node = builder.AddDirectory();
    AddMetadata(&builder, node);
    nodes.push_back(node);
  }
  if (!nodes.empty()) {
    builder.AddDirectoryReferences(root, 330, 4, {nodes.front()});
    for (std::size_t index = 0; index + 1 < nodes.size(); ++index) {
      builder.AddDirectoryReferences(nodes[index], 330, 4, {nodes[index + 1]});
    }
  }
  return builder.Build(root);
}

std::vector<std::uint8_t> MakeMainPages(std::size_t count) {
  TiffBuilder builder;
  const int data = builder.AddImageData({0x42});
  RasterOptions options;
  std::vector<int> pages;
  for (std::size_t index = 0; index < count; ++index) {
    pages.push_back(AddRasterDirectory(&builder, options, {data}, {1}));
  }
  for (std::size_t index = 0; index + 1 < pages.size(); ++index) {
    builder.SetNext(pages[index], pages[index + 1]);
  }
  return builder.Build(pages.front());
}

}  // namespace

int RunTiffCases() {
  TestRunner tests;
  TiffLayout layout;
  std::string error;

  auto little = OnePage();
  tests.Check(Analyze(little, &layout) && !layout.big_endian &&
                  layout.frames.size() == 1 &&
                  layout.frames[0].width == 1 &&
                  layout.frames[0].height == 1 &&
                  layout.decoded_bytes == 4 &&
                  layout.logical_bytes == little.size(),
              "tiff-le-classic-header-and-raster");

  TiffBuilder big_builder(true);
  const int big_data = big_builder.AddImageData({0x31, 0x32});
  RasterOptions big_options;
  big_options.width = 2;
  const int big_page =
      AddRasterDirectory(&big_builder, big_options, {big_data}, {2});
  auto big = big_builder.Build(big_page);
  tests.Check(Analyze(big, &layout) && layout.big_endian &&
                  layout.frames.size() == 1 && layout.frames[0].width == 2,
              "tiff-be-classic-header-and-values");

  auto pages = MakeMainPages(2);
  tests.Check(Analyze(pages, &layout) && layout.frames.size() == 2 &&
                  layout.decoded_bytes == 8,
              "tiff-main-ifd-chain-retains-all-pages");

  TiffBuilder alpha_builder;
  const int alpha_data =
      alpha_builder.AddImageData(std::vector<std::uint8_t>(16, 0xaa));
  RasterOptions alpha;
  alpha.width = 2;
  alpha.height = 2;
  alpha.samples_per_pixel = 4;
  alpha.photometric_interpretation = 2;
  alpha.extra_samples = {2};
  alpha.bits_per_sample = {16, 16, 16, 16};
  const int alpha_page =
      AddRasterDirectory(&alpha_builder, alpha, {alpha_data}, {16});
  auto alpha_bytes = alpha_builder.Build(alpha_page);
  tests.Check(Analyze(alpha_bytes, &layout) &&
                  layout.frames[0].decoded_bytes == 16,
              "tiff-16bit-four-sample-alpha-layout");

  TiffBuilder strips_builder;
  const int strip_a = strips_builder.AddImageData({0x11, 0x12});
  const int strip_b = strips_builder.AddImageData({0x21, 0x22, 0x23});
  RasterOptions strips;
  strips.width = 2;
  strips.height = 4;
  strips.rows_per_strip = 2;
  const int strips_page = AddRasterDirectory(
      &strips_builder, strips, {strip_a, strip_b}, {2, 3});
  auto strips_bytes = strips_builder.Build(strips_page);
  tests.Check(Analyze(strips_bytes, &layout) && layout.frames[0].height == 4,
              "tiff-multiple-strip-offset-and-count-arrays");

  TiffBuilder tiles_builder;
  const int tile_a = tiles_builder.AddImageData({0x11, 0x12});
  const int tile_b = tiles_builder.AddImageData({0x21, 0x22, 0x23});
  RasterOptions tiles;
  tiles.width = 3;
  tiles.height = 2;
  tiles.tiled = true;
  tiles.tile_width = 2;
  tiles.tile_height = 2;
  const int tiles_page = AddRasterDirectory(
      &tiles_builder, tiles, {tile_a, tile_b}, {2, 3});
  auto tiles_bytes = tiles_builder.Build(tiles_page);
  tests.Check(Analyze(tiles_bytes, &layout) && layout.frames[0].width == 3,
              "tiff-multiple-tile-offset-and-count-arrays");

  TiffBuilder graph_builder;
  const int graph_data = graph_builder.AddImageData({0x41, 0x42});
  const int graph_root =
      AddRasterDirectory(&graph_builder, RasterOptions{}, {graph_data}, {2});
  const int sub_ifd = graph_builder.AddDirectory();
  const int exif_ifd = graph_builder.AddDirectory();
  const int gps_ifd = graph_builder.AddDirectory();
  const int interop_ifd = graph_builder.AddDirectory();
  AddMetadata(&graph_builder, sub_ifd, 's');
  graph_builder.AddBytes(sub_ifd, 34675, 7, {'i', 'c', 'c', 'p', 'r', 'f'});
  graph_builder.AddBytes(sub_ifd, 40001, 1, {0x10, 0x20, 0x30, 0x40, 0x50});
  AddMetadata(&graph_builder, exif_ifd, 'e');
  graph_builder.AddDirectoryReferences(exif_ifd, 40965, 4, {interop_ifd});
  AddMetadata(&graph_builder, gps_ifd, 'g');
  AddMetadata(&graph_builder, interop_ifd, 'i');
  graph_builder.AddDirectoryReferences(graph_root, 330, 4, {sub_ifd});
  graph_builder.AddDirectoryReferences(graph_root, 34665, 4, {exif_ifd});
  graph_builder.AddDirectoryReferences(graph_root, 34853, 4, {gps_ifd});
  auto graph = graph_builder.Build(graph_root);
  tests.Check(Analyze(graph, &layout) && layout.frames.size() == 1 &&
                  layout.logical_bytes == graph.size(),
              "tiff-icc-private-exif-gps-subifd-interop-graph");

  TiffBuilder shared_builder;
  const int shared_a = shared_builder.AddImageData({0x61, 0x62});
  const int shared_b = shared_builder.AddImageData({0x71});
  RasterOptions shared;
  shared.width = 1;
  shared.height = 3;
  shared.rows_per_strip = 1;
  const int shared_page = AddRasterDirectory(
      &shared_builder, shared, {shared_b, shared_a, shared_b}, {1, 2, 1});
  auto shared_bytes = shared_builder.Build(shared_page);
  tests.Check(Analyze(shared_bytes, &layout) &&
                  layout.frames[0].height == 3,
              "tiff-nonmonotone-and-shared-strip-ranges");

  TiffBuilder shared_pages_builder;
  const int shared_page_data = shared_pages_builder.AddImageData({0x7a});
  const int shared_page_a = AddRasterDirectory(
      &shared_pages_builder, RasterOptions{}, {shared_page_data}, {1});
  const int shared_page_b = AddRasterDirectory(
      &shared_pages_builder, RasterOptions{}, {shared_page_data}, {1});
  shared_pages_builder.SetNext(shared_page_a, shared_page_b);
  auto shared_pages = shared_pages_builder.Build(shared_page_a);
  tests.Check(Analyze(shared_pages, &layout) && layout.frames.size() == 2,
              "tiff-shared-data-range-across-main-pages");

  auto zero_padded = little;
  zero_padded.insert(zero_padded.end(), 19, 0);
  tests.Check(Analyze(zero_padded, &layout) &&
                  layout.logical_bytes == little.size(),
              "tiff-zero-global-allocation-padding-excluded");

  auto nonzero_tail = little;
  nonzero_tail.push_back(0x5a);
  tests.Check(!Analyze(nonzero_tail, &layout, &error) &&
                  error.find("ambiguous") != std::string::npos,
              "tiff-nonzero-unreferenced-tail-is-ambiguous");

  tests.Check(!AnalyzeTiff(little.data(), 7, &layout),
              "tiff-truncated-header-rejected");

  TiffBuilder ifd_truncated_builder;
  const int ifd_data = ifd_truncated_builder.AddImageData({0x31});
  const int ifd_page = AddRasterDirectory(
      &ifd_truncated_builder, RasterOptions{}, {ifd_data}, {1});
  auto ifd_truncated = ifd_truncated_builder.Build(ifd_page);
  ifd_truncated.resize(ifd_truncated_builder.IfdOffset(ifd_page) + 9);
  tests.Check(!Analyze(ifd_truncated, &layout),
              "tiff-truncated-ifd-entry-rejected");

  auto data_truncated = little;
  data_truncated.pop_back();
  tests.Check(!Analyze(data_truncated, &layout),
              "tiff-truncated-image-data-rejected");

  TiffBuilder count_builder;
  const int count_data = count_builder.AddImageData({0x31});
  const int count_page = AddRasterDirectory(
      &count_builder, RasterOptions{}, {count_data}, {1});
  count_builder.AddBytes(count_page, 305, 2,
                         {'s', 'o', 'f', 't', 'w', 'r', 0});
  auto count_overflow = count_builder.Build(count_page);
  Put32(&count_overflow,
        static_cast<std::size_t>(count_builder.EntryOffset(count_page, 305) + 4),
        UINT32_MAX);
  tests.Check(!Analyze(count_overflow, &layout),
              "tiff-field-count-out-of-bounds-rejected");

  TiffBuilder offset_builder;
  const int offset_data = offset_builder.AddImageData({0x31});
  const int offset_page = AddRasterDirectory(
      &offset_builder, RasterOptions{}, {offset_data}, {1});
  auto offset_overflow = offset_builder.Build(offset_page);
  Put32(&offset_overflow,
        static_cast<std::size_t>(offset_builder.EntryOffset(offset_page, 273) + 8),
        0xfffffff0u);
  Put32(&offset_overflow,
        static_cast<std::size_t>(offset_builder.EntryOffset(offset_page, 279) + 8),
        0x40u);
  tests.Check(!Analyze(offset_overflow, &layout),
              "tiff-offset-plus-count-exceeds-allocation-rejected");

  RasterOptions pixel_overflow;
  pixel_overflow.width = 8192;
  pixel_overflow.height = 8192;
  auto pixel_overflow_bytes = OnePage(pixel_overflow);
  tests.Check(!Analyze(pixel_overflow_bytes, &layout),
              "tiff-dimension-pixel-budget-rejected");

  TiffBuilder cycle_builder;
  const int cycle_data = cycle_builder.AddImageData({0x31});
  const int cycle_root = AddRasterDirectory(
      &cycle_builder, RasterOptions{}, {cycle_data}, {1});
  cycle_builder.AddDirectoryReferences(cycle_root, 330, 4, {cycle_root});
  auto cycle = cycle_builder.Build(cycle_root);
  tests.Check(!Analyze(cycle, &layout, &error) &&
                  error.find("cycle") != std::string::npos,
              "tiff-ifd-graph-cycle-rejected");

  auto nodes_256 = MakeNodeGraph(256);
  tests.Check(Analyze(nodes_256, &layout) && layout.frames.size() == 1,
              "tiff-ifd-node-limit-256-accepted");
  auto nodes_257 = MakeNodeGraph(257);
  tests.Check(!Analyze(nodes_257, &layout),
              "tiff-ifd-node-limit-257-rejected");

  auto depth_32 = MakeDepthGraph(32);
  tests.Check(Analyze(depth_32, &layout),
              "tiff-ifd-depth-limit-32-accepted");
  auto depth_33 = MakeDepthGraph(33);
  tests.Check(!Analyze(depth_33, &layout, &error) &&
                  error.find("depth") != std::string::npos,
              "tiff-ifd-depth-limit-33-rejected");

  auto pages_32 = MakeMainPages(32);
  tests.Check(Analyze(pages_32, &layout) && layout.frames.size() == 32,
              "tiff-main-frame-limit-32-accepted");
  auto pages_33 = MakeMainPages(33);
  tests.Check(!Analyze(pages_33, &layout),
              "tiff-main-frame-limit-33-rejected");

  auto big_tiff = little;
  Put16(&big_tiff, 2, 43);
  tests.Check(!Analyze(big_tiff, &layout, &error) &&
                  error.find("BigTIFF") != std::string::npos,
              "tiff-bigtiff-explicitly-unsupported");

  TiffBuilder type_builder;
  const int type_data = type_builder.AddImageData({0x31});
  const int type_page = AddRasterDirectory(
      &type_builder, RasterOptions{}, {type_data}, {1});
  auto unknown_type = type_builder.Build(type_page);
  Put16(&unknown_type,
        static_cast<std::size_t>(type_builder.EntryOffset(type_page, 258) + 2),
        14);
  tests.Check(!Analyze(unknown_type, &layout, &error) &&
                  error.find("unknown data type") != std::string::npos,
              "tiff-unknown-field-type-rejected");

  TiffBuilder exact_pixels_builder;
  const int exact_data = exact_pixels_builder.AddImageData({0x31});
  RasterOptions exact_pixels;
  exact_pixels.width = 8192;
  exact_pixels.height = 4096;
  const int exact_pixels_page = AddRasterDirectory(
      &exact_pixels_builder, exact_pixels, {exact_data}, {1});
  auto exact_pixels_bytes = exact_pixels_builder.Build(exact_pixels_page);
  tests.Check(Analyze(exact_pixels_bytes, &layout) &&
                  layout.frames[0].decoded_bytes == 128ull * 1024ull * 1024ull,
              "tiff-per-page-pixel-limit-exact-boundary");

  TiffBuilder expanded_exact_builder;
  const int expanded_data = expanded_exact_builder.AddImageData({0x31});
  RasterOptions expanded_page_options;
  expanded_page_options.width = 8192;
  expanded_page_options.height = 4096;
  const int expanded_a = AddRasterDirectory(
      &expanded_exact_builder, expanded_page_options, {expanded_data}, {1});
  const int expanded_b = AddRasterDirectory(
      &expanded_exact_builder, expanded_page_options, {expanded_data}, {1});
  expanded_exact_builder.SetNext(expanded_a, expanded_b);
  auto expanded_exact = expanded_exact_builder.Build(expanded_a);
  tests.Check(Analyze(expanded_exact, &layout) &&
                  layout.decoded_bytes == kMaximumTiffExpandedBytes,
              "tiff-total-expanded-budget-exact-boundary");

  TiffBuilder expanded_over_builder;
  const int expanded_over_data = expanded_over_builder.AddImageData({0x31});
  const int expanded_over_a = AddRasterDirectory(
      &expanded_over_builder, expanded_page_options, {expanded_over_data}, {1});
  const int expanded_over_b = AddRasterDirectory(
      &expanded_over_builder, expanded_page_options, {expanded_over_data}, {1});
  const int expanded_over_c = AddRasterDirectory(
      &expanded_over_builder, expanded_page_options, {expanded_over_data}, {1});
  expanded_over_builder.SetNext(expanded_over_a, expanded_over_b);
  expanded_over_builder.SetNext(expanded_over_b, expanded_over_c);
  auto expanded_over = expanded_over_builder.Build(expanded_over_a);
  tests.Check(!Analyze(expanded_over, &layout),
              "tiff-total-expanded-budget-over-limit-rejected");

  TiffBuilder tile_stride_builder;
  const int tile_stride_data = tile_stride_builder.AddImageData({0x31});
  RasterOptions tile_stride;
  tile_stride.width = 8192;
  tile_stride.height = 4096;
  tile_stride.tiled = true;
  tile_stride.tile_width = 1;
  tile_stride.tile_height = 1;
  const int tile_stride_page = AddRasterDirectory(
      &tile_stride_builder, tile_stride, {tile_stride_data}, {1});
  auto tile_stride_bytes = tile_stride_builder.Build(tile_stride_page);
  tests.Check(!Analyze(tile_stride_bytes, &layout),
              "tiff-tile-offset-count-mismatch-rejected");

  auto oversized = little;
  oversized.resize(kMaximumTiffBytes + 1, 0);
  tests.Check(!Analyze(oversized, &layout),
              "tiff-global-allocation-limit-enforced");

  layout.logical_bytes = 99;
  layout.decoded_bytes = 99;
  layout.frames.push_back({9, 9, 9});
  tests.Check(!AnalyzeTiff(offset_overflow.data(), offset_overflow.size(),
                           &layout) &&
                  layout.logical_bytes == 0 && layout.decoded_bytes == 0 &&
                  layout.frames.empty() && !layout.big_endian,
              "tiff-failure-clears-prior-layout");

  return tests.failed + RunTiffReferenceCases();
}
