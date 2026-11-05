#include "clipboard_rtf.h"

#include <cstdint>
#include <string_view>

namespace clipboard_format_probe {
namespace {

constexpr std::size_t kMaximumRtfGroupDepth = 128;
constexpr std::size_t kMaximumControlWordBytes = 32;

bool IsAsciiLetter(std::uint8_t byte) noexcept {
  return (byte >= 'a' && byte <= 'z') || (byte >= 'A' && byte <= 'Z');
}

bool IsAsciiDigit(std::uint8_t byte) noexcept {
  return byte >= '0' && byte <= '9';
}

bool IsAsciiHex(std::uint8_t byte) noexcept {
  return IsAsciiDigit(byte) || (byte >= 'a' && byte <= 'f') ||
         (byte >= 'A' && byte <= 'F');
}

bool IsAsciiWhitespace(std::uint8_t byte) noexcept {
  return byte == ' ' || byte == '\t' || byte == '\r' || byte == '\n' ||
         byte == '\f' || byte == '\v';
}

struct ParsedControlWord {
  std::string_view name;
  bool has_parameter = false;
  bool negative_parameter = false;
  std::size_t parameter_digits = 0;
  std::int32_t parameter = 0;
  bool had_space_delimiter = false;
};

bool ParseControlWord(const std::uint8_t* bytes, std::size_t size,
                      std::size_t* cursor,
                      ParsedControlWord* parsed) noexcept {
  *parsed = ParsedControlWord{};
  if (*cursor >= size || !IsAsciiLetter(bytes[*cursor])) return false;

  const std::size_t word_start = *cursor;
  std::size_t word_length = 0;
  while (*cursor < size && IsAsciiLetter(bytes[*cursor])) {
    ++*cursor;
    if (++word_length > kMaximumControlWordBytes) return false;
  }
  parsed->name = std::string_view(
      reinterpret_cast<const char*>(bytes + word_start), word_length);

  bool negative = false;
  if (*cursor + 1 < size && bytes[*cursor] == '-' &&
      IsAsciiDigit(bytes[*cursor + 1])) {
    negative = true;
    ++*cursor;
  }

  if (*cursor < size && IsAsciiDigit(bytes[*cursor])) {
    parsed->has_parameter = true;
    parsed->negative_parameter = negative;
    const std::uint32_t maximum_magnitude =
        negative ? 2147483648u : 2147483647u;
    std::uint32_t magnitude = 0;
    while (*cursor < size && IsAsciiDigit(bytes[*cursor])) {
      const std::uint32_t digit =
          static_cast<std::uint32_t>(bytes[*cursor] - '0');
      if (magnitude > (maximum_magnitude - digit) / 10) return false;
      magnitude = magnitude * 10 + digit;
      ++parsed->parameter_digits;
      ++*cursor;
    }

    if (negative) {
      parsed->parameter =
          magnitude == 2147483648u
              ? (-2147483647 - 1)
              : -static_cast<std::int32_t>(magnitude);
    } else {
      parsed->parameter = static_cast<std::int32_t>(magnitude);
    }
  }

  if (*cursor < size && bytes[*cursor] == ' ') {
    parsed->had_space_delimiter = true;
    ++*cursor;
  }
  return true;
}

bool IsHexEscape(const std::uint8_t* bytes, std::size_t size,
                 std::size_t* cursor) noexcept {
  if (size - *cursor < 2 || !IsAsciiHex(bytes[*cursor]) ||
      !IsAsciiHex(bytes[*cursor + 1])) {
    return false;
  }
  *cursor += 2;
  return true;
}

}  // namespace

bool AnalyzeRtfFraming(const std::uint8_t* bytes, std::size_t size,
                       RtfFraming* framing) noexcept {
  if (framing == nullptr) return false;
  *framing = RtfFraming{};

  if (bytes == nullptr || size < 7 || size > kMaximumRtfFramingBytes ||
      bytes[0] != '{' || bytes[1] != '\\') {
    return false;
  }

  std::size_t cursor = 2;
  ParsedControlWord root;
  if (!ParseControlWord(bytes, size, &cursor, &root) ||
      root.name != "rtf" || !root.has_parameter ||
      root.negative_parameter || root.parameter_digits != 1 ||
      root.parameter != 1 ||
      (!root.had_space_delimiter && cursor < size &&
       IsAsciiLetter(bytes[cursor]))) {
    return false;
  }

  std::size_t depth = 1;
  std::size_t root_end = 0;
  while (cursor < size) {
    const std::uint8_t byte = bytes[cursor++];
    if (byte == 0) return false;

    if (byte == '{') {
      if (depth >= kMaximumRtfGroupDepth) return false;
      ++depth;
      continue;
    }
    if (byte == '}') {
      if (depth == 0) return false;
      --depth;
      if (depth == 0) {
        root_end = cursor;
        break;
      }
      continue;
    }
    if (byte != '\\') continue;
    if (cursor >= size || bytes[cursor] == 0) return false;

    if (IsAsciiLetter(bytes[cursor])) {
      ParsedControlWord control;
      if (!ParseControlWord(bytes, size, &cursor, &control)) return false;
      if (control.name == "bin") {
        if (!control.has_parameter || control.negative_parameter ||
            control.parameter < 0) {
          return false;
        }
        const std::size_t binary_bytes =
            static_cast<std::size_t>(control.parameter);
        if (binary_bytes > size - cursor) return false;
        cursor += binary_bytes;
      }
      continue;
    }

    if (bytes[cursor] == '\'') {
      ++cursor;
      if (!IsHexEscape(bytes, size, &cursor)) return false;
    } else {
      // RTF control symbols, including escaped braces and backslashes, consume
      // exactly the one byte following the backslash.
      ++cursor;
    }
  }

  if (root_end == 0) return false;

  std::size_t logical_length = root_end;
  bool saw_zero_padding = false;
  for (std::size_t index = root_end; index < size; ++index) {
    const std::uint8_t byte = bytes[index];
    if (byte == 0) {
      saw_zero_padding = true;
      continue;
    }
    if (saw_zero_padding || !IsAsciiWhitespace(byte)) return false;
    logical_length = index + 1;
  }

  framing->root_end = root_end;
  framing->logical_length = logical_length;
  return true;
}

}  // namespace clipboard_format_probe
