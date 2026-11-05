#include "png_cases.h"

#include "../common/clipboard_png.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <utility>
#include <vector>

namespace {

using Bytes = std::vector<std::uint8_t>;

constexpr std::array<std::uint8_t, 8> kSignature = {
    0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a};

struct Chunk {
  std::string type;
  Bytes data;
};

void AppendBigEndian32(Bytes* bytes, std::uint32_t value) {
  bytes->push_back(static_cast<std::uint8_t>(value >> 24));
  bytes->push_back(static_cast<std::uint8_t>(value >> 16));
  bytes->push_back(static_cast<std::uint8_t>(value >> 8));
  bytes->push_back(static_cast<std::uint8_t>(value));
}

std::uint32_t TestCrc32(const std::uint8_t* bytes, std::size_t size) {
  std::uint32_t crc = 0xffffffffu;
  for (std::size_t index = 0; index < size; ++index) {
    crc ^= bytes[index];
    for (int bit = 0; bit < 8; ++bit) {
      crc = (crc & 1u) != 0 ? (crc >> 1) ^ 0xedb88320u : crc >> 1;
    }
  }
  return crc ^ 0xffffffffu;
}

void AppendChunk(Bytes* bytes, const Chunk& chunk) {
  AppendBigEndian32(bytes, static_cast<std::uint32_t>(chunk.data.size()));
  const auto* type = reinterpret_cast<const std::uint8_t*>(chunk.type.data());
  bytes->insert(bytes->end(), type, type + chunk.type.size());
  bytes->insert(bytes->end(), chunk.data.begin(), chunk.data.end());
  Bytes crc_bytes(type, type + chunk.type.size());
  crc_bytes.insert(crc_bytes.end(), chunk.data.begin(), chunk.data.end());
  AppendBigEndian32(bytes, TestCrc32(crc_bytes.data(), crc_bytes.size()));
}

Bytes MakeHeader(std::uint32_t width = 1, std::uint32_t height = 1,
                 std::uint8_t depth = 8, std::uint8_t color = 6,
                 std::uint8_t interlace = 0) {
  Bytes data;
  AppendBigEndian32(&data, width);
  AppendBigEndian32(&data, height);
  data.push_back(depth);
  data.push_back(color);
  data.push_back(0);
  data.push_back(0);
  data.push_back(interlace);
  return data;
}

Bytes MakePng(const std::vector<Chunk>& chunks) {
  Bytes bytes(kSignature.begin(), kSignature.end());
  for (const auto& chunk : chunks) AppendChunk(&bytes, chunk);
  return bytes;
}

Bytes MakePng(std::uint32_t width = 1, std::uint32_t height = 1,
              std::uint8_t depth = 8, std::uint8_t color = 6,
              std::uint8_t interlace = 0) {
  return MakePng({{"IHDR", MakeHeader(width, height, depth, color, interlace)},
                  {"IDAT", {0x78, 0x9c}}, {"IEND", {}}});
}

void RebuildHeaderCrc(Bytes* bytes) {
  constexpr std::size_t kHeaderTypeOffset = kSignature.size() + 4;
  constexpr std::size_t kHeaderCrcOffset = kSignature.size() + 8 + 13;
  const auto crc = TestCrc32(bytes->data() + kHeaderTypeOffset, 17);
  (*bytes)[kHeaderCrcOffset] = static_cast<std::uint8_t>(crc >> 24);
  (*bytes)[kHeaderCrcOffset + 1] = static_cast<std::uint8_t>(crc >> 16);
  (*bytes)[kHeaderCrcOffset + 2] = static_cast<std::uint8_t>(crc >> 8);
  (*bytes)[kHeaderCrcOffset + 3] = static_cast<std::uint8_t>(crc);
}

void SetHeader(Bytes* bytes, std::size_t offset, std::uint8_t value) {
  (*bytes)[kSignature.size() + 8 + offset] = value;
  RebuildHeaderCrc(bytes);
}

bool Analyze(const Bytes& bytes, clipboard_codecs::PngLayout* layout,
             std::string* error = nullptr) {
  return clipboard_codecs::AnalyzePng(bytes.data(), bytes.size(), layout,
                                      error);
}

bool IsRejected(const Bytes& bytes) {
  clipboard_codecs::PngLayout layout;
  return !Analyze(bytes, &layout);
}

bool Expect(const char* name, bool condition) {
  std::printf("%s %s\n", condition ? "PASS" : "FAIL", name);
  return condition;
}

Bytes IndexedPng(const Bytes& palette) {
  return MakePng({{"IHDR", MakeHeader(1, 1, 2, 3)},
                  {"PLTE", palette}, {"IDAT", {0x78, 0x9c}},
                  {"IEND", {}}});
}

}  // namespace

int RunPngCases() {
  int failures = 0;
  const auto check = [&failures](const char* name, bool condition) {
    if (!Expect(name, condition)) ++failures;
  };
  clipboard_codecs::PngLayout layout;
  std::string error;

  const Bytes basic = MakePng();
  check("png.structure-valid-static", Analyze(basic, &layout) &&
                                          layout.logical_bytes == basic.size() &&
                                          layout.width == 1 && layout.height == 1);

  constexpr std::array<std::pair<std::uint8_t, std::uint8_t>, 15> kLegalCombos =
      {{{0, 1}, {0, 2}, {0, 4}, {0, 8}, {0, 16},
        {2, 8}, {2, 16}, {3, 1}, {3, 2}, {3, 4}, {3, 8},
        {4, 8}, {4, 16}, {6, 8}, {6, 16}}};
  bool all_legal_combinations_accepted = true;
  for (const auto& combo : kLegalCombos) {
    const auto sample = combo.first == 3
                            ? MakePng({{"IHDR", MakeHeader(1, 1, combo.second,
                                                            combo.first)},
                                       {"PLTE", {0, 0, 0}},
                                       {"IDAT", {0x78, 0x9c}}, {"IEND", {}}})
                            : MakePng(1, 1, combo.second, combo.first);
    all_legal_combinations_accepted &= Analyze(sample, &layout);
  }
  check("png.all-legal-color-depth-combinations",
        all_legal_combinations_accepted);

  constexpr std::array<std::pair<std::uint8_t, std::uint8_t>, 8> kIllegalCombos =
      {{{0, 3}, {2, 1}, {2, 4}, {3, 16}, {4, 1}, {4, 4}, {6, 1}, {6, 4}}};
  bool all_illegal_combinations_rejected = true;
  for (const auto& combo : kIllegalCombos) {
    const auto sample = MakePng(1, 1, combo.second, combo.first);
    all_illegal_combinations_rejected &= IsRejected(sample);
  }
  check("png.all-illegal-color-depth-combinations",
        all_illegal_combinations_rejected);

  const Bytes split_idat = MakePng(
      {{"IHDR", MakeHeader()}, {"IDAT", {0x78}}, {"IDAT", {0x9c}},
       {"IEND", {}}});
  check("png.consecutive-multiple-idat", Analyze(split_idat, &layout));

  const Bytes adam7 = MakePng(64, 48, 8, 6, 1);
  check("png.adam7-layout", Analyze(adam7, &layout) &&
                                layout.interlace_method == 1 &&
                                layout.filtered_scanline_bytes > 0);

  const Bytes indexed = IndexedPng({0, 0, 0, 255, 255, 255, 10, 20, 30});
  check("png.indexed-palette-valid", Analyze(indexed, &layout));

  Bytes padded = basic;
  const Bytes original = padded;
  padded.insert(padded.end(), {0, 0, 0, 0});
  check("png.zero-allocation-padding-trimmed",
        Analyze(padded, &layout) && layout.logical_bytes == original.size() &&
            std::equal(original.begin(), original.end(), padded.begin()));
  Bytes nonzero_padding = basic;
  nonzero_padding.insert(nonzero_padding.end(), {0xa5, 0x7f});
  check("png.nonzero-allocation-padding-trimmed",
        Analyze(nonzero_padding, &layout) &&
            layout.logical_bytes == basic.size());

  Bytes bad_crc = basic;
  bad_crc[kSignature.size() + 8 + 13 + 4 + 8] ^= 0x01;
  check("png.chunk-crc-rejected", IsRejected(bad_crc));

  Bytes bad_signature = basic;
  bad_signature[0] = 0;
  check("png.signature-rejected", IsRejected(bad_signature));

  Bytes huge_chunk = basic;
  huge_chunk[kSignature.size()] = 0xff;
  huge_chunk[kSignature.size() + 1] = 0xff;
  huge_chunk[kSignature.size() + 2] = 0xff;
  huge_chunk[kSignature.size() + 3] = 0xff;
  check("png.chunk-length-overflow-rejected", IsRejected(huge_chunk));

  const Bytes no_header = MakePng({{"IDAT", {1}}, {"IEND", {}}});
  check("png.missing-ihdr-rejected", IsRejected(no_header));
  const Bytes header_not_first = MakePng(
      {{"tEXt", {1}}, {"IHDR", MakeHeader()}, {"IDAT", {1}}, {"IEND", {}}});
  check("png-ihdr-must-be-first", IsRejected(header_not_first));
  const Bytes duplicate_header = MakePng(
      {{"IHDR", MakeHeader()}, {"IHDR", MakeHeader()}, {"IDAT", {1}},
       {"IEND", {}}});
  check("png.duplicate-ihdr-rejected", IsRejected(duplicate_header));

  const Bytes no_idat = MakePng({{"IHDR", MakeHeader()}, {"IEND", {}}});
  check("png.missing-idat-rejected", IsRejected(no_idat));
  const Bytes empty_idat = MakePng(
      {{"IHDR", MakeHeader()}, {"IDAT", {}}, {"IEND", {}}});
  check("png.empty-idat-stream-rejected", IsRejected(empty_idat));
  const Bytes missing_end = MakePng({{"IHDR", MakeHeader()}, {"IDAT", {1}}});
  check("png.missing-iend-rejected", IsRejected(missing_end));
  const Bytes nonempty_end = MakePng(
      {{"IHDR", MakeHeader()}, {"IDAT", {1}}, {"IEND", {0}}});
  check("png.nonempty-iend-rejected", IsRejected(nonempty_end));
  const Bytes separated_idat = MakePng(
      {{"IHDR", MakeHeader()}, {"IDAT", {1}}, {"tEXt", {2}},
       {"IDAT", {3}}, {"IEND", {}}});
  check("png.nonconsecutive-idat-rejected", IsRejected(separated_idat));

  const Bytes unknown_ancillary = MakePng(
      {{"IHDR", MakeHeader()}, {"tEXt", {1}}, {"IDAT", {2}}, {"IEND", {}}});
  check("png.unknown-ancillary-accepted", Analyze(unknown_ancillary, &layout));
  const Bytes unknown_critical = MakePng(
      {{"IHDR", MakeHeader()}, {"ABCD", {}}, {"IDAT", {1}}, {"IEND", {}}});
  check("png.unknown-critical-rejected", IsRejected(unknown_critical));

  const Bytes apng = MakePng({{"IHDR", MakeHeader()}, {"acTL", {0, 0, 0, 1,
                                                                   0, 0, 0, 0}},
                              {"IDAT", {1}}, {"IEND", {}}});
  check("png.apng-explicitly-unsupported",
        !Analyze(apng, &layout, &error) &&
            error == "APNG animation is unsupported");

  Bytes bad_depth = MakePng();
  SetHeader(&bad_depth, 8, 4);
  check("png.illegal-color-depth-combination", IsRejected(bad_depth));
  Bytes bad_color = MakePng();
  SetHeader(&bad_color, 9, 7);
  check("png.unknown-color-type-rejected", IsRejected(bad_color));
  Bytes bad_compression = MakePng();
  SetHeader(&bad_compression, 10, 1);
  check("png.unknown-compression-method-rejected", IsRejected(bad_compression));
  Bytes bad_filter = MakePng();
  SetHeader(&bad_filter, 11, 1);
  check("png.unknown-filter-method-rejected", IsRejected(bad_filter));
  Bytes bad_interlace = MakePng();
  SetHeader(&bad_interlace, 12, 2);
  check("png.unknown-interlace-method-rejected", IsRejected(bad_interlace));

  Bytes zero_width = MakePng();
  std::fill(zero_width.begin() + 16, zero_width.begin() + 20, 0);
  RebuildHeaderCrc(&zero_width);
  check("png.zero-width-rejected", IsRejected(zero_width));
  const Bytes oversized_side = MakePng(8193, 1);
  check("png.side-budget-rejected", IsRejected(oversized_side));
  const Bytes excessive_pixels = MakePng(8192, 8192);
  check("png.pixel-budget-rejected", IsRejected(excessive_pixels));
  const Bytes maximum_side = MakePng(8192, 1);
  check("png.maximum-side-accepted", Analyze(maximum_side, &layout));

  Bytes exact_encoded_limit = basic;
  exact_encoded_limit.resize(clipboard_codecs::kMaximumPngBytes, 0);
  check("png.encoded-budget-boundary-accepted",
        Analyze(exact_encoded_limit, &layout) &&
            layout.logical_bytes == basic.size());

  const Bytes no_palette = MakePng({{"IHDR", MakeHeader(1, 1, 2, 3)},
                                    {"IDAT", {1}}, {"IEND", {}}});
  check("png.indexed-palette-required", IsRejected(no_palette));
  const Bytes bad_palette = IndexedPng({0, 0});
  check("png.palette-length-rejected", IsRejected(bad_palette));
  Bytes oversized_palette = {0, 0, 0, 0};
  for (int entry = 0; entry < 9; ++entry) {
    oversized_palette.insert(oversized_palette.end(), {0, 0, 0});
  }
  check("png.palette-depth-budget-rejected", IsRejected(IndexedPng(oversized_palette)));
  const Bytes grayscale_palette = MakePng(
      {{"IHDR", MakeHeader(1, 1, 8, 0)}, {"PLTE", {0, 0, 0}},
       {"IDAT", {1}}, {"IEND", {}}});
  check("png.grayscale-palette-rejected", IsRejected(grayscale_palette));
  const Bytes palette_after_idat = MakePng(
      {{"IHDR", MakeHeader(1, 1, 8, 2)}, {"IDAT", {1}},
       {"PLTE", {0, 0, 0}}, {"IEND", {}}});
  check("png.palette-after-idat-rejected", IsRejected(palette_after_idat));

  Bytes too_large = basic;
  too_large.resize(clipboard_codecs::kMaximumPngBytes + 1, 0);
  check("png.encoded-budget-rejected", IsRejected(too_large));

  return failures == 0 ? 0 : 1;
}
