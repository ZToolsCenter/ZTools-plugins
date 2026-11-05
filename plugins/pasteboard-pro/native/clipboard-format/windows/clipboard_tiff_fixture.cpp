#include "clipboard_tiff_fixture.h"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <iterator>
#include <limits>
#include <utility>
#include <vector>

namespace clipboard_format_probe::tiff_fixtures {
namespace {

enum class ByteOrder { little, big };

struct Page {
  std::uint32_t width = 1;
  std::uint32_t height = 1;
  std::uint16_t channels = 3;
  std::uint16_t bits = 8;
  std::uint16_t compression = 1;
};

struct PageOffsets {
  std::size_t ifd = 0;
  std::size_t bits = 0;
  std::size_t pixels = 0;
  std::size_t pixel_size = 0;
  std::size_t entry_count = 0;
};

void Write16(std::vector<std::uint8_t>* bytes, std::size_t offset,
             std::uint16_t value, ByteOrder order) {
  if (order == ByteOrder::little) {
    (*bytes)[offset] = static_cast<std::uint8_t>(value);
    (*bytes)[offset + 1] = static_cast<std::uint8_t>(value >> 8);
  } else {
    (*bytes)[offset] = static_cast<std::uint8_t>(value >> 8);
    (*bytes)[offset + 1] = static_cast<std::uint8_t>(value);
  }
}

void Write32(std::vector<std::uint8_t>* bytes, std::size_t offset,
             std::uint32_t value, ByteOrder order) {
  if (order == ByteOrder::little) {
    (*bytes)[offset] = static_cast<std::uint8_t>(value);
    (*bytes)[offset + 1] = static_cast<std::uint8_t>(value >> 8);
    (*bytes)[offset + 2] = static_cast<std::uint8_t>(value >> 16);
    (*bytes)[offset + 3] = static_cast<std::uint8_t>(value >> 24);
  } else {
    (*bytes)[offset] = static_cast<std::uint8_t>(value >> 24);
    (*bytes)[offset + 1] = static_cast<std::uint8_t>(value >> 16);
    (*bytes)[offset + 2] = static_cast<std::uint8_t>(value >> 8);
    (*bytes)[offset + 3] = static_cast<std::uint8_t>(value);
  }
}

std::size_t Align2(std::size_t value) { return (value + 1) & ~std::size_t{1}; }

std::size_t PixelBytes(const Page& page) {
  if (page.compression != 1) return 8;
  const std::uint64_t bytes = static_cast<std::uint64_t>(page.width) *
                              page.height * page.channels * (page.bits / 8);
  if (bytes > std::numeric_limits<std::size_t>::max()) return 0;
  return static_cast<std::size_t>(bytes);
}

void SetEntry(std::vector<std::uint8_t>* bytes, std::size_t offset,
              std::uint16_t tag, std::uint16_t type, std::uint32_t count,
              std::uint32_t value, bool short_inline, ByteOrder order) {
  Write16(bytes, offset, tag, order);
  Write16(bytes, offset + 2, type, order);
  Write32(bytes, offset + 4, count, order);
  if (short_inline) {
    Write16(bytes, offset + 8, static_cast<std::uint16_t>(value), order);
    Write16(bytes, offset + 10, 0, order);
  } else {
    Write32(bytes, offset + 8, value, order);
  }
}

FormatPayload MakePayload(UINT format_id, const std::vector<Page>& pages,
                          ByteOrder order) {
  if (pages.empty() || pages.size() > 32) return {};
  std::vector<PageOffsets> offsets(pages.size());
  std::size_t cursor = 8;
  for (std::size_t index = 0; index < pages.size(); ++index) {
    offsets[index].ifd = cursor;
    offsets[index].entry_count = pages[index].channels == 4 ? 11 : 10;
    cursor += 2 + offsets[index].entry_count * 12 + 4;
  }
  for (std::size_t index = 0; index < pages.size(); ++index) {
    cursor = Align2(cursor);
    offsets[index].bits = cursor;
    cursor += pages[index].channels * sizeof(std::uint16_t);
  }
  for (std::size_t index = 0; index < pages.size(); ++index) {
    cursor = Align2(cursor);
    offsets[index].pixels = cursor;
    offsets[index].pixel_size = PixelBytes(pages[index]);
    if (offsets[index].pixel_size == 0 ||
        cursor > std::numeric_limits<std::uint32_t>::max() -
                     offsets[index].pixel_size) {
      return {};
    }
    cursor += offsets[index].pixel_size;
  }
  if (cursor > std::numeric_limits<std::uint32_t>::max()) return {};

  std::vector<std::uint8_t> bytes(cursor, 0);
  if (order == ByteOrder::little) {
    bytes[0] = 'I';
    bytes[1] = 'I';
  } else {
    bytes[0] = 'M';
    bytes[1] = 'M';
  }
  Write16(&bytes, 2, 42, order);
  Write32(&bytes, 4, static_cast<std::uint32_t>(offsets.front().ifd), order);

  for (std::size_t page_index = 0; page_index < pages.size(); ++page_index) {
    const Page& page = pages[page_index];
    const PageOffsets& page_offsets = offsets[page_index];
    Write16(&bytes, page_offsets.ifd,
            static_cast<std::uint16_t>(page_offsets.entry_count), order);
    std::size_t entry = page_offsets.ifd + 2;
    const auto long_value = [&](std::uint16_t tag, std::uint32_t value) {
      SetEntry(&bytes, entry, tag, 4, 1, value, false, order);
      entry += 12;
    };
    const auto short_value = [&](std::uint16_t tag, std::uint16_t value) {
      SetEntry(&bytes, entry, tag, 3, 1, value, true, order);
      entry += 12;
    };

    long_value(256, page.width);
    long_value(257, page.height);
    SetEntry(&bytes, entry, 258, 3, page.channels,
             static_cast<std::uint32_t>(page_offsets.bits), false, order);
    entry += 12;
    short_value(259, page.compression);
    short_value(262, 2);  // RGB photometric interpretation.
    long_value(273, static_cast<std::uint32_t>(page_offsets.pixels));
    short_value(277, page.channels);
    long_value(278, page.height);
    long_value(279, static_cast<std::uint32_t>(page_offsets.pixel_size));
    short_value(284, 1);  // Chunky planar configuration.
    if (page.channels == 4) short_value(338, 2);  // Unassociated alpha.
    const std::uint32_t next_ifd =
        page_index + 1 < pages.size()
            ? static_cast<std::uint32_t>(offsets[page_index + 1].ifd)
            : 0;
    Write32(&bytes, page_offsets.ifd + 2 + page_offsets.entry_count * 12,
            next_ifd, order);

    for (std::uint16_t channel = 0; channel < page.channels; ++channel) {
      Write16(&bytes, page_offsets.bits + channel * 2, page.bits, order);
    }
    if (page.compression != 1) {
      const std::uint8_t invalid_lzw[] = {0xff, 0xff, 0xff, 0xff,
                                          0xff, 0xff, 0xff, 0xff};
      std::copy(std::begin(invalid_lzw), std::end(invalid_lzw),
                bytes.begin() + page_offsets.pixels);
    } else if (page.bits == 16) {
      for (std::uint16_t channel = 0; channel < page.channels; ++channel) {
        Write16(&bytes, page_offsets.pixels + channel * 2,
                static_cast<std::uint16_t>(0x1234 + channel * 0x1111), order);
      }
    } else {
      for (std::size_t pixel = 0; pixel < page.pixel_size; ++pixel) {
        bytes[page_offsets.pixels + pixel] =
            static_cast<std::uint8_t>(0x30 + page_index * 17 + pixel * 23);
      }
    }
  }

  FormatPayload result{"tiff", L"CF_TIFF", format_id, std::move(bytes)};
  result.encoding = "tiff6-bytes";
  result.fidelity = "representation-bytes-preserved";
  result.source_format = "CF_TIFF";
  result.source_origin = "unknown";
  result.materialization = "current-clipboard-format-bytes";
  return result;
}

}  // namespace

FormatPayload MakeTiff(UINT format_id) {
  return MakePayload(format_id, {Page{}}, ByteOrder::little);
}

FormatPayload MakeMultipageTiff(UINT format_id) {
  return MakePayload(format_id, {Page{}, Page{}}, ByteOrder::big);
}

FormatPayload Make16BitAlphaTiff(UINT format_id) {
  return MakePayload(format_id, {Page{1, 1, 4, 16, 1}}, ByteOrder::little);
}

FormatPayload MakeMalformedCompressedTiff(UINT format_id) {
  return MakePayload(format_id, {Page{1, 1, 3, 8, 5}}, ByteOrder::little);
}

FormatPayload MakePixelBudgetTiff(UINT format_id) {
  return MakePayload(format_id, {Page{8192, 4097, 3, 8, 5}}, ByteOrder::little);
}

}  // namespace clipboard_format_probe::tiff_fixtures
