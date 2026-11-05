#include "clipboard_formats.h"

#include "../common/clipboard_codecs.h"
#include "../common/clipboard_palette.h"

#include <algorithm>
#include <limits>
#include <new>

namespace clipboard_format_probe {
namespace {

bool Make24BitLayout(const BITMAP& bitmap, std::size_t* row_bytes,
                     std::size_t* pixels_bytes) {
  if (bitmap.bmWidth <= 0 || bitmap.bmHeight <= 0 || row_bytes == nullptr ||
      pixels_bytes == nullptr || bitmap.bmWidth > 32768 ||
      bitmap.bmHeight > 32768) {
    return false;
  }
  const std::size_t width = static_cast<std::size_t>(bitmap.bmWidth);
  const std::size_t height = static_cast<std::size_t>(bitmap.bmHeight);
  if (width > (std::numeric_limits<std::size_t>::max() - 31) / 24) {
    return false;
  }
  const std::size_t row_bits = width * 24;
  *row_bytes = ((row_bits + 31) / 32) * 4;
  if (height != 0 && *row_bytes > std::numeric_limits<std::size_t>::max() / height) {
    return false;
  }
  *pixels_bytes = *row_bytes * height;
  return *pixels_bytes <= clipboard_codecs::kMaximumDibBytes - 40;
}

}  // namespace

bool CopyBitmapToDib(HBITMAP bitmap, FormatPayload* format,
                     std::string* error) {
  if (bitmap == nullptr || format == nullptr || error == nullptr) return false;
  BITMAP description{};
  if (GetObjectW(bitmap, static_cast<int>(sizeof(description)), &description) !=
      static_cast<int>(sizeof(description))) {
    *error = "CF_BITMAP dimensions could not be read";
    return false;
  }
  std::size_t row_bytes = 0;
  std::size_t pixels_bytes = 0;
  if (!Make24BitLayout(description, &row_bytes, &pixels_bytes)) {
    *error = "CF_BITMAP dimensions exceed the bounded DIB codec";
    return false;
  }

  std::vector<std::uint8_t> bytes;
  try {
    bytes.assign(40 + pixels_bytes, 0);
  } catch (const std::bad_alloc&) {
    *error = "CF_BITMAP materialization exceeded available memory";
    return false;
  }
  if (row_bytes * static_cast<std::size_t>(description.bmHeight) !=
      pixels_bytes) {
    *error = "CF_BITMAP scanline layout was inconsistent";
    return false;
  }
  auto write32 = [&bytes](std::size_t offset, std::uint32_t value) {
    for (std::size_t index = 0; index < 4; ++index) {
      bytes[offset + index] =
          static_cast<std::uint8_t>((value >> (index * 8)) & 0xff);
    }
  };
  bytes[0] = 40;
  write32(4, static_cast<std::uint32_t>(description.bmWidth));
  write32(8, static_cast<std::uint32_t>(-description.bmHeight));
  bytes[12] = 1;
  bytes[14] = 24;
  write32(20, static_cast<std::uint32_t>(pixels_bytes));

  HDC dc = CreateCompatibleDC(nullptr);
  if (dc == nullptr) {
    *error = "a compatible GDI device context could not be created";
    return false;
  }
  BITMAPINFOHEADER header{};
  header.biSize = sizeof(header);
  header.biWidth = description.bmWidth;
  header.biHeight = -description.bmHeight;
  header.biPlanes = 1;
  header.biBitCount = 24;
  header.biCompression = BI_RGB;
  header.biSizeImage = static_cast<DWORD>(pixels_bytes);
  const int rows = GetDIBits(dc, bitmap, 0,
                            static_cast<UINT>(description.bmHeight),
                            bytes.data() + 40,
                            reinterpret_cast<BITMAPINFO*>(&header),
                            DIB_RGB_COLORS);
  DeleteDC(dc);
  if (rows != description.bmHeight) {
    *error = "GetDIBits did not materialize every CF_BITMAP scanline";
    return false;
  }

  clipboard_codecs::DibLayout layout;
  if (!clipboard_codecs::AnalyzeDib(bytes.data(), bytes.size(), &layout) ||
      layout.logical_bytes != bytes.size() || layout.width != description.bmWidth ||
      layout.height != static_cast<std::uint32_t>(description.bmHeight)) {
    *error = "the materialized CF_BITMAP DIB failed validation";
    return false;
  }
  format->bytes = std::move(bytes);
  format->encoding = "dib24-rendered";
  format->fidelity = "visible-rgb-compatible";
  format->source_origin = "unknown";
  format->materialization = "win32-getdibits-24bpp-top-down";
  return true;
}

HBITMAP CreateBitmapFromDib(const FormatPayload& format,
                            std::string* error) {
  clipboard_codecs::DibLayout layout;
  if (!clipboard_codecs::AnalyzeDib(format.bytes.data(), format.bytes.size(),
                                    &layout) ||
      layout.logical_bytes != format.bytes.size() ||
      layout.width > static_cast<std::uint32_t>(std::numeric_limits<LONG>::max()) ||
      layout.height > static_cast<std::uint32_t>(std::numeric_limits<LONG>::max())) {
    if (error != nullptr) *error = "CF_BITMAP DIB failed codec validation";
    return nullptr;
  }
  HDC dc = CreateCompatibleDC(nullptr);
  if (dc == nullptr) {
    if (error != nullptr) *error = "a compatible GDI device context could not be created";
    return nullptr;
  }
  const auto* info = reinterpret_cast<const BITMAPINFOHEADER*>(format.bytes.data());
  const auto* bitmap_info = reinterpret_cast<const BITMAPINFO*>(format.bytes.data());
  HBITMAP result = CreateDIBitmap(
      dc, info, CBM_INIT, format.bytes.data() + layout.pixel_offset,
      bitmap_info, DIB_RGB_COLORS);
  DeleteDC(dc);
  if (result == nullptr && error != nullptr) {
    *error = "CreateDIBitmap could not rebuild a CF_BITMAP handle";
  }
  return result;
}

bool CopyPaletteToLogPalette(HPALETTE palette, FormatPayload* format,
                             std::string* error) {
  if (palette == nullptr || format == nullptr || error == nullptr) return false;
  alignas(4) WORD entry_count = 0;
  if (GetObjectW(palette, static_cast<int>(sizeof(entry_count)),
                 &entry_count) <= 0 ||
      entry_count == 0 ||
      static_cast<std::size_t>(entry_count) >
          clipboard_codecs::kMaximumPaletteEntries) {
    *error = "CF_PALETTE entry count is outside the bounded codec";
    return false;
  }
  std::vector<PALETTEENTRY> native_entries;
  std::vector<clipboard_codecs::PaletteEntry> entries;
  std::vector<std::uint8_t> bytes;
  try {
    native_entries.resize(entry_count);
    entries.resize(entry_count);
  } catch (const std::bad_alloc&) {
    *error = "CF_PALETTE materialization exceeded available memory";
    return false;
  }
  if (GetPaletteEntries(palette, 0, entry_count, native_entries.data()) !=
      entry_count) {
    *error = "GetPaletteEntries did not materialize every entry";
    return false;
  }
  for (std::size_t index = 0; index < entry_count; ++index) {
    entries[index] = {native_entries[index].peRed,
                      native_entries[index].peGreen,
                      native_entries[index].peBlue,
                      native_entries[index].peFlags};
  }
  try {
    if (!clipboard_codecs::EncodePalette(entries, &bytes)) {
      *error = "CF_PALETTE entries failed bounded validation";
      return false;
    }
  } catch (const std::bad_alloc&) {
    *error = "CF_PALETTE serialization exceeded available memory";
    return false;
  }
  format->bytes = std::move(bytes);
  format->fidelity = "palette-entries-preserved";
  format->source_origin = "unknown";
  format->materialization = "win32-getpaletteentries-logpalette-v0300";
  return true;
}

HPALETTE CreatePaletteFromLogPalette(const FormatPayload& format,
                                     std::string* error) {
  clipboard_codecs::PaletteLayout layout;
  if (!clipboard_codecs::AnalyzePalette(format.bytes.data(), format.bytes.size(),
                                        &layout) ||
      layout.logical_bytes != format.bytes.size()) {
    if (error != nullptr) *error = "CF_PALETTE failed codec validation";
    return nullptr;
  }
  struct PaletteBuffer {
    WORD version;
    WORD count;
    PALETTEENTRY entries[clipboard_codecs::kMaximumPaletteEntries];
  } native{};
  static_assert(offsetof(PaletteBuffer, entries) ==
                    offsetof(LOGPALETTE, palPalEntry),
                "LOGPALETTE storage layout mismatch");
  static_assert(sizeof(PALETTEENTRY) == 4,
                "Windows PALETTEENTRY must contain four bytes");
  native.version = layout.version;
  native.count = layout.entry_count;
  for (std::size_t index = 0; index < layout.entry_count; ++index) {
    native.entries[index] = PALETTEENTRY{
        format.bytes[4 + index * 4], format.bytes[4 + index * 4 + 1],
        format.bytes[4 + index * 4 + 2], format.bytes[4 + index * 4 + 3]};
  }
  HPALETTE palette = CreatePalette(reinterpret_cast<const LOGPALETTE*>(&native));
  if (palette == nullptr && error != nullptr) {
    *error = "CreatePalette could not rebuild the CF_PALETTE handle";
  }
  return palette;
}

}  // namespace clipboard_format_probe
