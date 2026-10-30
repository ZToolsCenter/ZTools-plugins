#include "clipboard_tiff.h"

#include "clipboard_tiff_internal.h"

#include <algorithm>
#include <new>
#include <stdexcept>
#include <utility>

namespace clipboard_codecs {
namespace {

bool Fail(TiffLayout* layout, std::string* error,
          const char* message) noexcept {
  if (layout != nullptr) *layout = {};
  if (error != nullptr) {
    try {
      *error = message;
    } catch (...) {
      error->clear();
    }
  }
  return false;
}

bool IsBigEndian(const std::uint8_t* bytes) {
  return bytes[0] == 'M' && bytes[1] == 'M';
}

}  // namespace

bool AnalyzeTiff(const std::uint8_t* bytes, std::size_t size, TiffLayout* layout,
                 std::string* error) try {
  if (layout == nullptr) {
    return Fail(nullptr, error, "TIFF output layout is required");
  }
  *layout = {};
  if (error != nullptr) error->clear();

  if (bytes == nullptr || size < 8 || size > kMaximumTiffBytes) {
    return Fail(layout, error, "TIFF allocation is empty, truncated, or too large");
  }
  const bool little_endian = bytes[0] == 'I' && bytes[1] == 'I';
  const bool big_endian = IsBigEndian(bytes);
  if (!little_endian && !big_endian) {
    return Fail(layout, error, "TIFF byte-order marker is invalid");
  }

  tiff_internal::Context context;
  context.bytes = bytes;
  context.size = size;
  context.big_endian = big_endian;
  context.logical_end = 8;

  std::uint16_t magic = 0;
  std::uint32_t first_ifd = 0;
  if (!context.Read16(2, &magic) || !context.Read32(4, &first_ifd)) {
    return Fail(layout, error, "TIFF header is truncated");
  }
  if (magic == 43) {
    return Fail(layout, error, "BigTIFF is unsupported");
  }
  if (magic != 42) {
    return Fail(layout, error, "TIFF magic number is invalid");
  }
  if (first_ifd == 0) {
    return Fail(layout, error, "TIFF must contain a primary IFD");
  }
  if (!tiff_internal::VisitIfdGraph(&context, first_ifd, 1)) {
    return Fail(layout, error, context.error.c_str());
  }

  TiffLayout parsed;
  parsed.big_endian = big_endian;
  std::uint32_t ifd_offset = first_ifd;
  std::size_t frame_count = 0;
  std::uint64_t native_expanded_total = 0;
  while (ifd_offset != 0) {
    if (++frame_count > kMaximumTiffFrames) {
      return Fail(layout, error, "TIFF has too many main-chain pages");
    }
    const auto found = context.directories.find(ifd_offset);
    if (found == context.directories.end()) {
      return Fail(layout, error, "TIFF main IFD was not validated");
    }
    TiffFrameLayout frame;
    std::uint64_t native_frame_bytes = 0;
    if (!tiff_internal::ValidateImageDirectory(
            &context, found->second, true, &frame, &native_frame_bytes)) {
      return Fail(layout, error, context.error.c_str());
    }
    if (frame.decoded_bytes >
        kMaximumTiffExpandedBytes - parsed.decoded_bytes) {
      return Fail(layout, error, "TIFF expanded RGBA32 budget is exceeded");
    }
    parsed.decoded_bytes += frame.decoded_bytes;
    if (native_frame_bytes >
        kMaximumTiffExpandedBytes - native_expanded_total) {
      return Fail(layout, error,
                  "TIFF native sample expansion budget is exceeded");
    }
    native_expanded_total += native_frame_bytes;
    parsed.frames.push_back(frame);
    ifd_offset = found->second.next_offset;
  }
  if (parsed.frames.empty()) {
    return Fail(layout, error, "TIFF has no main-chain image pages");
  }

  for (const auto& item : context.directories) {
    if (!tiff_internal::ValidateImageDirectory(
            &context, item.second, false, nullptr, nullptr)) {
      return Fail(layout, error, context.error.c_str());
    }
  }

  if (context.logical_end > size) {
    return Fail(layout, error, "TIFF referenced extent exceeds allocation");
  }
  if (!std::all_of(bytes + context.logical_end, bytes + size,
                   [](std::uint8_t value) { return value == 0; })) {
    return Fail(layout, error,
                "TIFF has a nonzero unreferenced tail; logical length is ambiguous");
  }

  parsed.logical_bytes = context.logical_end;
  *layout = std::move(parsed);
  return true;
} catch (const std::bad_alloc&) {
  return Fail(layout, error, "TIFF parser resource limit reached");
} catch (const std::length_error&) {
  return Fail(layout, error, "TIFF parser container limit reached");
} catch (...) {
  return Fail(layout, error, "TIFF parser failed safely");
}

}  // namespace clipboard_codecs
