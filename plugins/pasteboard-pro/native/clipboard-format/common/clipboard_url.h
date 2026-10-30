#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>

namespace clipboard_codecs {

inline constexpr std::size_t kMaximumUrlBytes = 64 * 1024;
inline constexpr std::size_t kMaximumUrlAllocationBytes =
    kMaximumUrlBytes + 4096;

enum class UrlValidationResult {
  valid,
  invalid,
  // Kept for source compatibility; the storage validator never returns this.
  unsupported_scheme,
};

struct UrlLayout {
  std::size_t content_bytes = 0;
  std::size_t logical_bytes = 0;
};

// The native buffers may include GlobalSize padding after the first NUL.
bool AnalyzeUrlAnsiBytes(const std::uint8_t* bytes, std::size_t size,
                         UrlLayout* layout);
bool AnalyzeUrlUtf16LE(const std::uint8_t* bytes, std::size_t size,
                       std::u16string* text, UrlLayout* layout);
// Bounded storage syntax only. Scheme execution and opening policy are separate.
UrlValidationResult ValidateUrlText(std::u16string_view text);

}  // namespace clipboard_codecs
