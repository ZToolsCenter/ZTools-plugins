#include "clipboard_reparse.h"

#include <utility>

namespace clipboard_reparse {
namespace {

std::uint16_t ReadU16(const std::uint8_t* bytes, std::size_t offset) {
  return static_cast<std::uint16_t>(bytes[offset]) |
         (static_cast<std::uint16_t>(bytes[offset + 1]) << 8);
}

std::uint32_t ReadU32(const std::uint8_t* bytes, std::size_t offset) {
  return static_cast<std::uint32_t>(bytes[offset]) |
         (static_cast<std::uint32_t>(bytes[offset + 1]) << 8) |
         (static_cast<std::uint32_t>(bytes[offset + 2]) << 16) |
         (static_cast<std::uint32_t>(bytes[offset + 3]) << 24);
}

bool IsKnownTag(std::uint32_t tag) {
  return tag == kSymbolicLinkTag || tag == kMountPointTag;
}

bool IsValidPathText(const std::u16string& text, bool allow_empty) {
  if ((!allow_empty && text.empty()) || text.size() > 32767) return false;
  for (std::size_t index = 0; index < text.size(); ++index) {
    const char16_t unit = text[index];
    if (unit == u'\0' || unit < 0x20) return false;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= text.size()) return false;
      const char16_t low = text[++index];
      if (low < 0xdc00 || low > 0xdfff) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

bool HasDotComponent(const std::u16string& text) {
  std::size_t start = 0;
  for (std::size_t index = 0; index <= text.size(); ++index) {
    const bool boundary = index == text.size() || text[index] == u'/' ||
        text[index] == static_cast<char16_t>(0x5c);
    if (!boundary) continue;
    const std::size_t length = index - start;
    if ((length == 1 && text[start] == u'.') ||
        (length == 2 && text[start] == u'.' && text[start + 1] == u'.')) {
      return true;
    }
    start = index + 1;
  }
  return false;
}

bool ReadName(const std::uint8_t* bytes, std::size_t path_start,
              std::size_t path_buffer_length, std::size_t offset,
              std::size_t length, bool allow_empty, std::u16string* output) {
  if (output == nullptr || offset % 2 != 0 || length % 2 != 0 ||
      offset > path_buffer_length || length > path_buffer_length - offset ||
      (!allow_empty && length == 0)) {
    return false;
  }
  std::u16string value;
  value.reserve(length / 2);
  for (std::size_t index = 0; index < length; index += 2) {
    const std::uint16_t unit =
        ReadU16(bytes, path_start + offset + index);
    value.push_back(static_cast<char16_t>(unit));
  }
  if (!IsValidPathText(value, allow_empty)) return false;
  *output = std::move(value);
  return true;
}

}  // namespace

bool ParseBuffer(const std::uint8_t* bytes, std::size_t capacity,
                 std::size_t returned, std::uint32_t expected_tag,
                 Target* output) {
  if (output == nullptr) return false;
  *output = {};
  if (bytes == nullptr || capacity < 8 || capacity > kMaximumBufferSize ||
      returned < 8 || returned > capacity || returned > kMaximumBufferSize ||
      !IsKnownTag(expected_tag)) {
    return false;
  }

  const std::uint32_t tag = ReadU32(bytes, 0);
  const std::size_t data_length = ReadU16(bytes, 4);
  // MS-FSCC requires consumers to ignore the reserved field.
  if (tag != expected_tag || data_length > returned - 8) {
    return false;
  }

  const bool symbolic_link = tag == kSymbolicLinkTag;
  const std::size_t fixed_length = symbolic_link ? 12 : 8;
  if (data_length < fixed_length) return false;
  const std::size_t path_buffer_length = data_length - fixed_length;
  const std::size_t substitute_offset = ReadU16(bytes, 8);
  const std::size_t substitute_length = ReadU16(bytes, 10);
  const std::size_t print_offset = ReadU16(bytes, 12);
  const std::size_t print_length = ReadU16(bytes, 14);
  const std::size_t path_start = 8 + fixed_length;

  Target parsed;
  if (symbolic_link) {
    const std::uint32_t flags = ReadU32(bytes, 16);
    if ((flags & ~1u) != 0) return false;
    parsed.is_relative = (flags & 1u) != 0;
  }
  if (!ReadName(bytes, path_start, path_buffer_length, substitute_offset,
                substitute_length, false, &parsed.substitute_name) ||
      !ReadName(bytes, path_start, path_buffer_length, print_offset,
                print_length, true, &parsed.print_name)) {
    return false;
  }
  if (!symbolic_link && (HasDotComponent(parsed.substitute_name) ||
                         HasDotComponent(parsed.print_name))) {
    return false;
  }
  *output = std::move(parsed);
  return true;
}

bool CanFollowHop(std::uint32_t hops_already_followed) {
  return hops_already_followed < kMaximumReparseHops;
}

}  // namespace clipboard_reparse
