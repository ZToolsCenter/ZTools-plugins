#include "clipboard_url.h"

#include "clipboard_codecs.h"
#include "clipboard_uri_syntax.h"

#include <algorithm>

namespace clipboard_codecs {
namespace {

std::uint16_t Read16(const std::uint8_t* bytes, std::size_t offset) {
  return static_cast<std::uint16_t>(bytes[offset]) |
         (static_cast<std::uint16_t>(bytes[offset + 1]) << 8);
}

}  // namespace

bool AnalyzeUrlAnsiBytes(const std::uint8_t* bytes, std::size_t size,
                         UrlLayout* layout) {
  if (bytes == nullptr || layout == nullptr || size == 0 ||
      size > kMaximumUrlAllocationBytes) {
    return false;
  }
  const auto terminator = std::find(bytes, bytes + size, 0);
  if (terminator == bytes + size) return false;
  const std::size_t content_bytes =
      static_cast<std::size_t>(terminator - bytes);
  const std::size_t logical_bytes = content_bytes + 1;
  if (content_bytes == 0 || logical_bytes > kMaximumUrlBytes) return false;
  layout->content_bytes = content_bytes;
  layout->logical_bytes = logical_bytes;
  return true;
}

bool AnalyzeUrlUtf16LE(const std::uint8_t* bytes, std::size_t size,
                       std::u16string* text, UrlLayout* layout) {
  if (bytes == nullptr || text == nullptr || layout == nullptr || size < 2 ||
      size > kMaximumUrlAllocationBytes) {
    return false;
  }
  std::size_t terminator = size;
  for (std::size_t offset = 0; offset + 1 < size; offset += 2) {
    if (bytes[offset] == 0 && bytes[offset + 1] == 0) {
      terminator = offset;
      break;
    }
  }
  const std::size_t logical_bytes = terminator + 2;
  if (terminator == size || terminator == 0 ||
      logical_bytes > kMaximumUrlBytes ||
      !IsValidUtf16(bytes, terminator)) {
    return false;
  }
  text->clear();
  text->reserve(terminator / 2);
  for (std::size_t offset = 0; offset < terminator; offset += 2) {
    text->push_back(static_cast<char16_t>(Read16(bytes, offset)));
  }
  layout->content_bytes = terminator;
  layout->logical_bytes = logical_bytes;
  return true;
}

UrlValidationResult ValidateUrlText(std::u16string_view text) {
  // The ANSI wire budget is measured in bytes before ACP decoding. ASCII can
  // therefore produce at most kMaximumUrlBytes - 1 UTF-16 code units after
  // accounting for its required NUL terminator. UTF-16 wire input is bounded
  // separately by AnalyzeUrlUtf16LE using its byte-accurate layout.
  constexpr std::size_t kMaximumDecodedCodeUnits = kMaximumUrlBytes - 1;
  return text.size() <= kMaximumDecodedCodeUnits &&
                 IsValidStoredAbsoluteUri(text)
             ? UrlValidationResult::valid
             : UrlValidationResult::invalid;
}

}  // namespace clipboard_codecs
