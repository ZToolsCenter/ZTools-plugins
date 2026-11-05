#include "clipboard_cf_html.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <string_view>

namespace clipboard_format_probe {
namespace {

constexpr std::string_view kStartMarker = "<!--StartFragment-->";
constexpr std::string_view kEndMarker = "<!--EndFragment-->";
constexpr std::size_t kMaximumHeaderNameBytes = 64;

struct HeaderField {
  std::string_view name;
  std::string_view value;
};

struct HeaderFields {
  std::array<HeaderField, kMaximumCfHtmlHeaderLines> fields{};
  std::size_t count = 0;
  std::size_t bytes = 0;
};

struct ParsedOffset {
  std::size_t value = 0;
  bool is_minus_one = false;
};

bool IsAsciiLetter(std::uint8_t byte) noexcept {
  return (byte >= 'a' && byte <= 'z') || (byte >= 'A' && byte <= 'Z');
}

bool IsAsciiDigit(std::uint8_t byte) noexcept {
  return byte >= '0' && byte <= '9';
}

bool IsHeaderNameByte(std::uint8_t byte) noexcept {
  return IsAsciiLetter(byte) || IsAsciiDigit(byte) || byte == '-' || byte == '_';
}

bool IsHorizontalWhitespace(char byte) noexcept {
  return byte == ' ' || byte == '\t';
}

bool IsTailWhitespace(std::uint8_t byte) noexcept {
  return byte == ' ' || (byte >= '\t' && byte <= '\r');
}

char AsciiLower(char byte) noexcept {
  return byte >= 'A' && byte <= 'Z'
             ? static_cast<char>(byte + ('a' - 'A'))
             : byte;
}

bool EqualsAsciiCaseInsensitive(std::string_view left,
                                std::string_view right) noexcept {
  if (left.size() != right.size()) return false;
  for (std::size_t index = 0; index < left.size(); ++index) {
    if (AsciiLower(left[index]) != AsciiLower(right[index])) return false;
  }
  return true;
}

bool IsValidHeaderName(std::string_view name) noexcept {
  if (name.empty() || name.size() > kMaximumHeaderNameBytes ||
      !IsAsciiLetter(static_cast<std::uint8_t>(name.front()))) {
    return false;
  }
  for (const char byte : name) {
    if (!IsHeaderNameByte(static_cast<std::uint8_t>(byte))) return false;
  }
  return true;
}

bool IsAsciiHeaderValue(std::string_view value) noexcept {
  for (const unsigned char byte : value) {
    if (byte != '\t' && (byte < 0x20 || byte > 0x7e)) return false;
  }
  return true;
}

std::string_view TrimHorizontalWhitespace(std::string_view value) noexcept {
  while (!value.empty() && IsHorizontalWhitespace(value.front())) {
    value.remove_prefix(1);
  }
  while (!value.empty() && IsHorizontalWhitespace(value.back())) {
    value.remove_suffix(1);
  }
  return value;
}

bool ReadLine(const std::uint8_t* bytes, std::size_t size, std::size_t start,
              std::string_view* line, std::size_t* next,
              bool* terminated) noexcept {
  if (start > size || line == nullptr || next == nullptr ||
      terminated == nullptr) {
    return false;
  }
  std::size_t cursor = start;
  while (cursor < size && bytes[cursor] != '\r' && bytes[cursor] != '\n') {
    ++cursor;
  }
  *line = std::string_view(reinterpret_cast<const char*>(bytes + start),
                           cursor - start);
  *terminated = cursor < size;
  if (cursor < size && bytes[cursor] == '\r' && cursor + 1 < size &&
      bytes[cursor + 1] == '\n') {
    cursor += 2;
  } else if (cursor < size) {
    ++cursor;
  }
  *next = cursor;
  return true;
}

bool ParseHeaderField(std::string_view line, HeaderField* field) noexcept {
  if (field == nullptr) return false;
  const std::size_t colon = line.find(':');
  if (colon == std::string_view::npos) return false;
  const std::string_view name = line.substr(0, colon);
  if (!IsValidHeaderName(name)) return false;
  const std::string_view value = line.substr(colon + 1);
  if (!IsAsciiHeaderValue(value)) return false;
  *field = HeaderField{name, value};
  return true;
}

bool AddHeaderField(HeaderFields* header, HeaderField field) noexcept {
  if (header == nullptr || header->count >= header->fields.size()) return false;
  for (std::size_t index = 0; index < header->count; ++index) {
    if (EqualsAsciiCaseInsensitive(header->fields[index].name, field.name)) {
      return false;
    }
  }
  header->fields[header->count++] = field;
  return true;
}

bool ParseHeader(const std::uint8_t* bytes, std::size_t size,
                 HeaderFields* header) noexcept {
  if (header == nullptr) return false;
  *header = HeaderFields{};
  if (size == 0) return false;

  std::size_t cursor = 0;
  std::size_t line_count = 0;
  while (true) {
    if (cursor > kMaximumCfHtmlHeaderBytes) return false;
    if (cursor == size || cursor == kMaximumCfHtmlHeaderBytes) {
      header->bytes = cursor;
      break;
    }

    std::string_view line;
    std::size_t next = cursor;
    bool terminated = false;
    if (!ReadLine(bytes, size, cursor, &line, &next, &terminated)) return false;

    if (line.empty()) {
      if (header->count == 0 || !terminated ||
          line_count >= kMaximumCfHtmlHeaderLines) {
        return false;
      }
      header->bytes = next;
      break;
    }

    HeaderField field;
    if (!ParseHeaderField(line, &field)) {
      if (header->count == 0) return false;
      header->bytes = cursor;
      break;
    }
    if (line_count >= kMaximumCfHtmlHeaderLines ||
        next > kMaximumCfHtmlHeaderBytes || !terminated ||
        !AddHeaderField(header, field)) {
      return false;
    }
    ++line_count;
    if (header->count == 1 && !EqualsAsciiCaseInsensitive(field.name, "Version")) {
      return false;
    }
    if (header->count > 1 && EqualsAsciiCaseInsensitive(field.name, "Version")) {
      return false;
    }

    cursor = next;
    header->bytes = cursor;
  }

  if (header->count == 0 || header->bytes > kMaximumCfHtmlHeaderBytes) {
    return false;
  }
  const std::string_view version =
      TrimHorizontalWhitespace(header->fields[0].value);
  return version == "0.9" || version == "1.0";
}

const HeaderField* FindField(const HeaderFields& header,
                             std::string_view name) noexcept {
  for (std::size_t index = 0; index < header.count; ++index) {
    if (EqualsAsciiCaseInsensitive(header.fields[index].name, name)) {
      return &header.fields[index];
    }
  }
  return nullptr;
}

bool ParseOffset(const HeaderFields& header, std::string_view name,
                 ParsedOffset* parsed, bool required = true) noexcept {
  if (parsed == nullptr) return false;
  *parsed = ParsedOffset{};
  const HeaderField* field = FindField(header, name);
  if (field == nullptr) return !required;

  std::string_view value = TrimHorizontalWhitespace(field->value);
  if (value == "-1") {
    parsed->is_minus_one = true;
    return true;
  }
  if (value.empty()) return false;

  std::size_t result = 0;
  for (const char byte : value) {
    if (byte < '0' || byte > '9') return false;
    const std::size_t digit = static_cast<std::size_t>(byte - '0');
    if (result > (std::numeric_limits<std::size_t>::max() - digit) / 10) {
      return false;
    }
    result = result * 10 + digit;
  }
  parsed->value = result;
  return true;
}

bool MatchAt(const std::uint8_t* bytes, std::size_t size, std::size_t offset,
             std::string_view marker) noexcept {
  if (offset > size || marker.size() > size - offset) return false;
  for (std::size_t index = 0; index < marker.size(); ++index) {
    if (bytes[offset + index] != static_cast<std::uint8_t>(marker[index])) {
      return false;
    }
  }
  return true;
}

std::size_t CountMarker(const std::uint8_t* bytes, std::size_t begin,
                        std::size_t end, std::string_view marker) noexcept {
  if (begin > end || marker.size() > end - begin) return 0;
  std::size_t count = 0;
  for (std::size_t offset = begin; offset <= end - marker.size(); ++offset) {
    if (MatchAt(bytes, end, offset, marker)) ++count;
  }
  return count;
}

bool IsValidUtf8Region(const std::uint8_t* bytes, std::size_t begin,
                       std::size_t end) noexcept {
  if (begin > end) return false;
  std::size_t cursor = begin;
  while (cursor < end) {
    const std::uint8_t first = bytes[cursor++];
    if (first <= 0x7f) continue;

    std::uint32_t code_point = 0;
    std::size_t continuation_count = 0;
    if (first >= 0xc2 && first <= 0xdf) {
      code_point = first & 0x1f;
      continuation_count = 1;
    } else if (first >= 0xe0 && first <= 0xef) {
      code_point = first & 0x0f;
      continuation_count = 2;
    } else if (first >= 0xf0 && first <= 0xf4) {
      code_point = first & 0x07;
      continuation_count = 3;
    } else {
      return false;
    }

    if (continuation_count > end - cursor) return false;
    for (std::size_t index = 0; index < continuation_count; ++index) {
      const std::uint8_t next = bytes[cursor++];
      if ((next & 0xc0) != 0x80) return false;
      if (index == 0 && first == 0xe0 && next < 0xa0) return false;
      if (index == 0 && first == 0xed && next >= 0xa0) return false;
      if (index == 0 && first == 0xf0 && next < 0x90) return false;
      if (index == 0 && first == 0xf4 && next > 0x8f) return false;
      code_point = (code_point << 6) | (next & 0x3f);
    }
    if (code_point > 0x10ffff || (code_point >= 0xd800 && code_point <= 0xdfff)) {
      return false;
    }
  }
  return true;
}

bool IsAsciiRegion(const std::uint8_t* bytes, std::size_t begin,
                   std::size_t end) noexcept {
  for (std::size_t index = begin; index < end; ++index) {
    if (bytes[index] > 0x7f) return false;
  }
  return true;
}

bool IsUtf8Boundary(const std::uint8_t* bytes, std::size_t offset,
                    std::size_t size) noexcept {
  return offset <= size &&
         (offset == size || (bytes[offset] & 0xc0) != 0x80);
}

bool FindLogicalLength(const std::uint8_t* bytes, std::size_t size,
                       std::size_t payload_end,
                       std::size_t* logical_bytes) noexcept {
  if (logical_bytes == nullptr || payload_end > size) return false;
  std::size_t logical = payload_end;
  bool saw_zero_padding = false;
  for (std::size_t index = payload_end; index < size; ++index) {
    const std::uint8_t byte = bytes[index];
    if (byte == 0) {
      saw_zero_padding = true;
      continue;
    }
    if (saw_zero_padding || !IsTailWhitespace(byte)) return false;
    logical = index + 1;
  }
  *logical_bytes = logical;
  return true;
}

}  // namespace

bool AnalyzeCfHtml(const std::uint8_t* bytes, std::size_t size,
                   CfHtmlLayout* layout) noexcept {
  if (layout == nullptr) return false;
  *layout = CfHtmlLayout{};
  if (bytes == nullptr || size == 0 || size > kMaximumCfHtmlBytes) return false;

  HeaderFields header;
  if (!ParseHeader(bytes, size, &header)) return false;

  ParsedOffset start_html;
  ParsedOffset end_html;
  ParsedOffset start_fragment;
  ParsedOffset end_fragment;
  ParsedOffset start_selection;
  ParsedOffset end_selection;
  if (!ParseOffset(header, "StartHTML", &start_html) ||
      !ParseOffset(header, "EndHTML", &end_html) ||
      !ParseOffset(header, "StartFragment", &start_fragment) ||
      !ParseOffset(header, "EndFragment", &end_fragment) ||
      !ParseOffset(header, "StartSelection", &start_selection, false) ||
      !ParseOffset(header, "EndSelection", &end_selection, false)) {
    return false;
  }

  const bool has_context = !start_html.is_minus_one && !end_html.is_minus_one;
  if (start_html.is_minus_one != end_html.is_minus_one ||
      start_fragment.is_minus_one || end_fragment.is_minus_one ||
      start_fragment.value > end_fragment.value) {
    return false;
  }
  const bool has_start_selection = FindField(header, "StartSelection") != nullptr;
  const bool has_end_selection = FindField(header, "EndSelection") != nullptr;
  if (has_start_selection != has_end_selection ||
      (has_start_selection &&
       (start_selection.is_minus_one || end_selection.is_minus_one ||
        start_selection.value < start_fragment.value ||
        start_selection.value > end_selection.value ||
        end_selection.value > end_fragment.value))) {
    return false;
  }

  std::size_t payload_end = 0;
  bool has_markers = false;
  if (has_context) {
    if (start_html.value != header.bytes || start_html.value >= end_html.value ||
        end_html.value > size || start_fragment.value < start_html.value ||
        end_fragment.value > end_html.value ||
        start_fragment.value < kStartMarker.size() ||
        !MatchAt(bytes, size, start_fragment.value - kStartMarker.size(),
                 kStartMarker) ||
        !MatchAt(bytes, size, end_fragment.value, kEndMarker) ||
        end_fragment.value > end_html.value - kEndMarker.size()) {
      return false;
    }
    if (CountMarker(bytes, start_html.value, end_html.value, kStartMarker) != 1 ||
        CountMarker(bytes, start_html.value, end_html.value, kEndMarker) != 1) {
      return false;
    }
    has_markers = true;
    payload_end = end_html.value;
  } else {
    if (start_fragment.value < header.bytes || end_fragment.value > size) {
      return false;
    }
    const std::size_t body_end = size;
    const std::size_t start_count =
        CountMarker(bytes, header.bytes, body_end, kStartMarker);
    const std::size_t end_count =
        CountMarker(bytes, header.bytes, body_end, kEndMarker);
    if (start_count != 0 || end_count != 0) {
      if (start_count != 1 || end_count != 1 ||
          start_fragment.value < kStartMarker.size() ||
          start_fragment.value - kStartMarker.size() != header.bytes ||
          !MatchAt(bytes, size, start_fragment.value - kStartMarker.size(),
                   kStartMarker) ||
          !MatchAt(bytes, size, end_fragment.value, kEndMarker) ||
          end_fragment.value > size - kEndMarker.size()) {
        return false;
      }
      has_markers = true;
      payload_end = end_fragment.value + kEndMarker.size();
    } else {
      if (start_fragment.value != header.bytes) return false;
      payload_end = end_fragment.value;
    }
  }

  std::size_t logical_bytes = 0;
  if (!FindLogicalLength(bytes, size, payload_end, &logical_bytes)) return false;
  if (start_fragment.value > logical_bytes || end_fragment.value > logical_bytes ||
      (has_context && end_html.value > logical_bytes) ||
      (has_markers && payload_end > logical_bytes)) {
    return false;
  }

  for (std::size_t index = 0; index < logical_bytes; ++index) {
    if (bytes[index] == 0) return false;
  }
  if (!IsAsciiRegion(bytes, 0, header.bytes) ||
      !IsValidUtf8Region(bytes, 0, logical_bytes) ||
      !IsValidUtf8Region(bytes, 0, header.bytes) ||
      !IsValidUtf8Region(bytes, header.bytes,
                         has_context ? end_html.value : logical_bytes) ||
      !IsValidUtf8Region(bytes, start_fragment.value, end_fragment.value) ||
      (has_start_selection &&
       (!IsUtf8Boundary(bytes, start_selection.value, logical_bytes) ||
        !IsUtf8Boundary(bytes, end_selection.value, logical_bytes) ||
        !IsValidUtf8Region(bytes, start_selection.value, end_selection.value)))) {
    return false;
  }

  *layout = CfHtmlLayout{
      header.bytes,
      has_context ? start_html.value : 0,
      has_context ? end_html.value : 0,
      start_fragment.value,
      end_fragment.value,
      logical_bytes,
      has_context,
  };
  return true;
}

}  // namespace clipboard_format_probe
