#include "png_cases.h"
#include "capture_wire_cases.h"
#include "capture_wire_v2_cases.h"
#include "cf_html_cases.h"
#include "url_cases.h"
#include "policy_cases.h"
#include "reparse_cases.h"
#include "rtf_cases.h"
#include "tiff_cases.h"
#include "clipboard_codecs.h"
#include "clipboard_palette.h"

#include <cstdint>
#include <iostream>
#include <limits>
#include <string>
#include <vector>

namespace {

void Put16(std::vector<std::uint8_t>* bytes, std::size_t offset,
           std::uint16_t value) {
  (*bytes)[offset] = static_cast<std::uint8_t>(value & 0xff);
  (*bytes)[offset + 1] = static_cast<std::uint8_t>(value >> 8);
}

void Put32(std::vector<std::uint8_t>* bytes, std::size_t offset,
           std::uint32_t value) {
  for (std::size_t index = 0; index < 4; ++index) {
    (*bytes)[offset + index] =
        static_cast<std::uint8_t>((value >> (index * 8)) & 0xff);
  }
}

std::vector<std::uint8_t> Dib24(std::uint32_t width = 2,
                                std::uint32_t height = 2) {
  const std::size_t row_bytes = ((width * 24 + 31) / 32) * 4;
  std::vector<std::uint8_t> bytes(40 + row_bytes * height, 0);
  Put32(&bytes, 0, 40);
  Put32(&bytes, 4, width);
  Put32(&bytes, 8, height);
  Put16(&bytes, 12, 1);
  Put16(&bytes, 14, 24);
  Put32(&bytes, 20, static_cast<std::uint32_t>(row_bytes * height));
  return bytes;
}

std::vector<std::uint8_t> DibV5WithProfile() {
  std::vector<std::uint8_t> bytes(124 + 16 + 8, 0);
  Put32(&bytes, 0, 124);
  Put32(&bytes, 4, 2);
  Put32(&bytes, 8, static_cast<std::uint32_t>(-2));
  Put16(&bytes, 12, 1);
  Put16(&bytes, 14, 32);
  Put32(&bytes, 16, 3);
  Put32(&bytes, 20, 16);
  Put32(&bytes, 40, 0x00ff0000);
  Put32(&bytes, 44, 0x0000ff00);
  Put32(&bytes, 48, 0x000000ff);
  Put32(&bytes, 52, 0xff000000);
  Put32(&bytes, 56, 0x4d424544);
  Put32(&bytes, 112, 140);
  Put32(&bytes, 116, 8);
  return bytes;
}

std::vector<std::uint8_t> DibCore1Bit() {
  std::vector<std::uint8_t> bytes(22, 0);
  Put32(&bytes, 0, 12);
  Put16(&bytes, 4, 2);
  Put16(&bytes, 6, 1);
  Put16(&bytes, 8, 1);
  Put16(&bytes, 10, 1);
  return bytes;
}

std::vector<std::uint8_t> Dib16Bitfields() {
  std::vector<std::uint8_t> bytes(56, 0);
  Put32(&bytes, 0, 40);
  Put32(&bytes, 4, 2);
  Put32(&bytes, 8, 1);
  Put16(&bytes, 12, 1);
  Put16(&bytes, 14, 16);
  Put32(&bytes, 16, 3);
  Put32(&bytes, 40, 0xf800);
  Put32(&bytes, 44, 0x07e0);
  Put32(&bytes, 48, 0x001f);
  return bytes;
}

std::vector<std::uint8_t> DropFilesAnsi() {
  const std::string paths("C:\\a.txt\0D:\\b.txt\0\0", 19);
  std::vector<std::uint8_t> bytes(20 + paths.size(), 0);
  Put32(&bytes, 0, 20);
  for (std::size_t index = 0; index < paths.size(); ++index) {
    bytes[20 + index] = static_cast<std::uint8_t>(paths[index]);
  }
  return bytes;
}

struct TestRunner {
  int failed = 0;
  void Check(bool condition, const char* name) {
    std::cout << (condition ? "PASS " : "FAIL ") << name << '\n';
    if (!condition) ++failed;
  }
};

}  // namespace

int main() {
  using namespace clipboard_codecs;
  TestRunner tests;
  DibLayout layout;
  auto dib = Dib24();
  tests.Check(AnalyzeDib(dib.data(), dib.size(), &layout) &&
                  layout.width == 2 && layout.height == 2 &&
                  layout.pixel_offset == 40 && layout.logical_bytes == dib.size(),
              "dib-valid-24bit-and-stride");
  auto core = DibCore1Bit();
  tests.Check(AnalyzeDib(core.data(), core.size(), &layout) &&
                  layout.header_bytes == 12 && layout.pixel_offset == 18 &&
                  layout.pixel_bytes == 4,
              "dib-core-header-and-rgbtriple-palette");
  auto bitfields = Dib16Bitfields();
  tests.Check(AnalyzeDib(bitfields.data(), bitfields.size(), &layout) &&
                  layout.pixel_offset == 52 && layout.pixel_bytes == 4,
              "dib-bitfields-masks-and-pixel-offset");

  auto padded = dib;
  padded.resize(padded.size() + 32, 0xa5);
  tests.Check(AnalyzeDib(padded.data(), padded.size(), &layout) &&
                  layout.logical_bytes == dib.size(),
              "dib-logical-length-trims-global-padding");
  auto sized_image = dib;
  sized_image.resize(sized_image.size() + 4, 0x7c);
  Put32(&sized_image, 20, 20);
  tests.Check(AnalyzeDib(sized_image.data(), sized_image.size(), &layout) &&
                  layout.logical_bytes == sized_image.size(),
              "dib-declared-image-bytes-retained");

  auto v5 = DibV5WithProfile();
  tests.Check(AnalyzeDib(v5.data(), v5.size(), &layout) &&
                  layout.header_bytes == 124 && layout.has_profile &&
                  layout.logical_bytes == v5.size() && layout.top_down,
              "dibv5-profile-and-top-down");

  auto bad_header = dib;
  Put32(&bad_header, 0, std::numeric_limits<std::uint32_t>::max());
  tests.Check(!AnalyzeDib(bad_header.data(), bad_header.size(), &layout),
              "dib-header-overflow-rejected");
  auto bad_width = dib;
  Put32(&bad_width, 4, 0x80000000);
  tests.Check(!AnalyzeDib(bad_width.data(), bad_width.size(), &layout),
              "dib-negative-width-rejected");
  auto truncated = dib;
  truncated.pop_back();
  tests.Check(!AnalyzeDib(truncated.data(), truncated.size(), &layout),
              "dib-truncated-pixels-rejected");
  auto invalid_masks = v5;
  Put32(&invalid_masks, 44, 0x00ff0000);
  tests.Check(!AnalyzeDib(invalid_masks.data(), invalid_masks.size(), &layout),
              "dib-overlapping-channel-masks-rejected");
  auto bad_profile = v5;
  Put32(&bad_profile, 112, std::numeric_limits<std::uint32_t>::max());
  tests.Check(!AnalyzeDib(bad_profile.data(), bad_profile.size(), &layout),
              "dibv5-profile-offset-overflow-rejected");
  auto bad_image_size = dib;
  Put32(&bad_image_size, 20, std::numeric_limits<std::uint32_t>::max());
  tests.Check(!AnalyzeDib(bad_image_size.data(), bad_image_size.size(), &layout),
              "dib-image-size-overflow-rejected");
  auto truncated_palette = core;
  truncated_palette.pop_back();
  tests.Check(!AnalyzeDib(truncated_palette.data(), truncated_palette.size(),
                          &layout),
              "dib-truncated-core-palette-and-pixels-rejected");

  const std::vector<std::uint8_t> ansi = {'A', 0, 0xee, 0x91};
  tests.Check(LogicalAnsiTextBytes(ansi.data(), ansi.size()) == 2,
              "ansi-terminator-trims-padding");
  const std::vector<std::uint8_t> ansi_unterminated = {'a', 'b'};
  tests.Check(!LogicalAnsiTextBytes(ansi_unterminated.data(),
                                    ansi_unterminated.size()).has_value(),
              "ansi-unclosed-string-rejected");
  const std::vector<std::uint8_t> locale = {0x09, 0x04, 0, 0, 0xff};
  std::uint32_t locale_id = 0;
  tests.Check(AnalyzeLocale(locale.data(), locale.size(), &locale_id) &&
                  locale_id == 0x0409,
              "locale-reads-bounded-lcid");

  std::vector<std::uint8_t> drop;
  const std::vector<std::u16string> paths = {u"C:\\tmp\\one.txt",
                                              u"D:\\资料\\二.txt",
                                              u"E:\\\U0001F4C4.txt"};
  DropFilesLayout drop_layout;
  std::string drop_error;
  const bool drop_built = BuildDropFilesWide(paths, &drop);
  const bool drop_parsed = drop_built &&
      AnalyzeDropFiles(drop.data(), drop.size(), &drop_layout, &drop_error);
  tests.Check(drop_built && drop_parsed &&
                  drop_layout.file_count == 3 && drop_layout.wide &&
                  drop_layout.logical_bytes == drop.size() &&
                  !drop_layout.non_client,
              "hdrop-utf16-path-list-and-double-nul");
  if (!drop_parsed) std::cerr << "hdrop fixture: " << drop_error << '\n';

  auto ansi_drop = DropFilesAnsi();
  tests.Check(AnalyzeDropFiles(ansi_drop.data(), ansi_drop.size(), &drop_layout) &&
                  drop_layout.file_count == 2 && !drop_layout.wide &&
                  drop_layout.logical_bytes == ansi_drop.size(),
              "hdrop-ansi-path-list-and-double-nul");

  auto drop_padded = drop;
  drop_padded.insert(drop_padded.end(), {0xa5});
  tests.Check(AnalyzeDropFiles(drop_padded.data(), drop_padded.size(),
                               &drop_layout) &&
                  drop_layout.logical_bytes == drop.size(),
              "hdrop-logical-length-trims-allocation-padding");
  auto bad_drop_offset = drop;
  Put32(&bad_drop_offset, 0, std::numeric_limits<std::uint32_t>::max());
  tests.Check(!AnalyzeDropFiles(bad_drop_offset.data(), bad_drop_offset.size(),
                                &drop_layout),
              "hdrop-offset-overflow-rejected");
  auto bad_drop_list = drop;
  bad_drop_list.resize(bad_drop_list.size() - 2);
  tests.Check(!AnalyzeDropFiles(bad_drop_list.data(), bad_drop_list.size(),
                                &drop_layout),
              "hdrop-missing-final-nul-rejected");
  auto bad_drop_utf16 = drop;
  Put16(&bad_drop_utf16, 20 + 4, 0xd800);
  Put16(&bad_drop_utf16, 20 + 6, 0);
  tests.Check(!AnalyzeDropFiles(bad_drop_utf16.data(), bad_drop_utf16.size(),
                                &drop_layout),
              "hdrop-unpaired-surrogate-rejected");
  const std::u16string embedded_nul(u"bad\0path", 8);
  tests.Check(!BuildDropFilesWide({embedded_nul}, &drop),
              "hdrop-embedded-nul-rejected");

  std::vector<PaletteEntry> entries = {{255, 0, 0, 0}, {0, 255, 0, 1}};
  std::vector<std::uint8_t> palette;
  PaletteLayout palette_layout;
  tests.Check(EncodePalette(entries, &palette) &&
                  AnalyzePalette(palette.data(), palette.size(),
                                 &palette_layout) &&
                  palette_layout.version == kLogicalPaletteVersion &&
                  palette_layout.entry_count == 2 &&
                  palette_layout.logical_bytes == palette.size(),
              "palette-v0300-entry-roundtrip");
  auto palette_padding = palette;
  palette_padding.insert(palette_padding.end(), {0xa5, 0xa5, 0xa5});
  tests.Check(AnalyzePalette(palette_padding.data(), palette_padding.size(),
                             &palette_layout) &&
                  palette_layout.logical_bytes == palette.size(),
              "palette-logical-length-trims-padding");
  auto bad_palette_version = palette;
  Put16(&bad_palette_version, 0, 0x0200);
  tests.Check(!AnalyzePalette(bad_palette_version.data(),
                              bad_palette_version.size(), &palette_layout),
              "palette-unsupported-version-rejected");
  auto bad_palette_count = palette;
  Put16(&bad_palette_count, 2, 257);
  tests.Check(!AnalyzePalette(bad_palette_count.data(), bad_palette_count.size(),
                              &palette_layout),
              "palette-over-limit-entry-count-rejected");
  auto empty_palette_count = palette;
  Put16(&empty_palette_count, 2, 0);
  tests.Check(!AnalyzePalette(empty_palette_count.data(),
                              empty_palette_count.size(), &palette_layout),
              "palette-zero-entry-count-rejected");
  std::vector<PaletteEntry> maximum_entries(kMaximumPaletteEntries,
                                             PaletteEntry{1, 2, 3, 0});
  std::vector<std::uint8_t> maximum_palette;
  tests.Check(EncodePalette(maximum_entries, &maximum_palette) &&
                  maximum_palette.size() == kMaximumPaletteBytes &&
                  AnalyzePalette(maximum_palette.data(), maximum_palette.size(),
                                 &palette_layout) &&
                  palette_layout.entry_count == kMaximumPaletteEntries,
              "palette-maximum-count-and-byte-boundary");
  maximum_palette.push_back(0);
  tests.Check(!AnalyzePalette(maximum_palette.data(), maximum_palette.size(),
                              &palette_layout),
              "palette-maximum-allocation-plus-padding-rejected");
  auto truncated_logpalette = palette;
  truncated_logpalette.pop_back();
  tests.Check(!AnalyzePalette(truncated_logpalette.data(),
                              truncated_logpalette.size(),
                              &palette_layout),
              "palette-truncated-entry-rejected");
  auto bad_palette_flags = palette;
  bad_palette_flags[7] = 0x80;
  tests.Check(!AnalyzePalette(bad_palette_flags.data(), bad_palette_flags.size(),
                              &palette_layout),
              "palette-unknown-entry-flags-rejected");
  bool combined_flags_rejected = true;
  for (const std::uint8_t flags : {3, 5, 6, 7}) {
    auto combined = palette;
    combined[7] = flags;
    std::vector<std::uint8_t> encoded;
    combined_flags_rejected =
        combined_flags_rejected &&
        !AnalyzePalette(combined.data(), combined.size(), &palette_layout) &&
        !EncodePalette({PaletteEntry{1, 2, 3, flags}}, &encoded);
  }
  tests.Check(combined_flags_rejected,
              "palette-combined-entry-flags-rejected");

  const bool png_passed = RunPngCases() == 0;
  const bool url_passed = RunUrlCases() == 0;
  const bool policy_passed = RunPolicyCases() == 0;
  const bool capture_wire_passed = RunCaptureWireCases() == 0;
  const bool capture_wire_v2_passed = RunCaptureWireV2Cases() == 0;
  const bool cf_html_passed = RunCfHtmlCases() == 0;
  const bool reparse_passed = RunReparseCases() == 0;
  const bool rtf_passed = RunRtfCases() == 0;
  const bool tiff_passed = RunTiffCases() == 0;
  return tests.failed == 0 && png_passed && url_passed && policy_passed &&
      reparse_passed && rtf_passed && tiff_passed && capture_wire_passed && capture_wire_v2_passed && cf_html_passed ? 0 : 1;
}
