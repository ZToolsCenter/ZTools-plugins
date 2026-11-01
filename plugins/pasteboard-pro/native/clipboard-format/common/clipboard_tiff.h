#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace clipboard_codecs {

inline constexpr std::size_t kMaximumTiffBytes = 20u * 1024u * 1024u;
inline constexpr std::uint64_t kMaximumTiffExpandedBytes =
    256ull * 1024ull * 1024ull;
inline constexpr std::uint32_t kMaximumTiffSide = 8192;
inline constexpr std::uint64_t kMaximumTiffPixels = 32ull * 1024ull * 1024ull;
inline constexpr std::size_t kMaximumTiffFrames = 32;
inline constexpr std::size_t kMaximumTiffIfdNodes = 256;
inline constexpr std::size_t kMaximumTiffIfdDepth = 32;

struct TiffFrameLayout {
  std::uint32_t width = 0;
  std::uint32_t height = 0;
  std::uint64_t decoded_bytes = 0;
};

struct TiffLayout {
  std::size_t logical_bytes = 0;
  std::uint64_t decoded_bytes = 0;
  bool big_endian = false;
  std::vector<TiffFrameLayout> frames;
};

// Analyzes classic TIFF 6.0 structure in a bounded allocation. Main-chain IFDs
// are returned as frames in source order. Metadata IFDs are validated but are
// not counted as frames. Pixels are not decoded; decoded_bytes is the bounded
// RGBA32 expansion estimate. Bytes are never rewritten.
//
// TIFF has no file-EOF field. logical_bytes ends at the furthest verified
// reference; only an all-zero tail is accepted as allocation padding. A
// nonzero unreferenced tail is ambiguous and causes rejection. BigTIFF and
// custom private payload pointer graphs are unsupported.
bool AnalyzeTiff(const std::uint8_t* bytes, std::size_t size, TiffLayout* layout,
                 std::string* error = nullptr);

}  // namespace clipboard_codecs
