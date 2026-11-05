#include "clipboard_tiff_internal.h"

#include <limits>
#include <utility>
#include <unordered_set>

namespace clipboard_codecs::tiff_internal {

bool Context::Read16(std::uint64_t offset, std::uint16_t* value) const {
  if (value == nullptr || !IsRange(offset, 2)) return false;
  const auto index = static_cast<std::size_t>(offset);
  if (big_endian) {
    *value = static_cast<std::uint16_t>(
        (static_cast<std::uint16_t>(bytes[index]) << 8) | bytes[index + 1]);
  } else {
    *value = static_cast<std::uint16_t>(
        bytes[index] | (static_cast<std::uint16_t>(bytes[index + 1]) << 8));
  }
  return true;
}

bool Context::Read32(std::uint64_t offset, std::uint32_t* value) const {
  if (value == nullptr || !IsRange(offset, 4)) return false;
  const auto index = static_cast<std::size_t>(offset);
  if (big_endian) {
    *value = (static_cast<std::uint32_t>(bytes[index]) << 24) |
             (static_cast<std::uint32_t>(bytes[index + 1]) << 16) |
             (static_cast<std::uint32_t>(bytes[index + 2]) << 8) |
             static_cast<std::uint32_t>(bytes[index + 3]);
  } else {
    *value = static_cast<std::uint32_t>(bytes[index]) |
             (static_cast<std::uint32_t>(bytes[index + 1]) << 8) |
             (static_cast<std::uint32_t>(bytes[index + 2]) << 16) |
             (static_cast<std::uint32_t>(bytes[index + 3]) << 24);
  }
  return true;
}

bool Context::IsRange(std::uint64_t offset, std::uint64_t length) const {
  return offset <= size && length <= static_cast<std::uint64_t>(size) - offset;
}

bool Context::Include(std::uint64_t offset, std::uint64_t length) {
  if (!IsRange(offset, length)) {
    return Fail("TIFF referenced range is outside the allocation");
  }
  const std::uint64_t end = offset + length;
  if (end > std::numeric_limits<std::size_t>::max()) {
    return Fail("TIFF referenced range overflows addressable size");
  }
  if (static_cast<std::size_t>(end) > logical_end) {
    logical_end = static_cast<std::size_t>(end);
  }
  return true;
}

bool Context::Fail(const char* message) {
  if (error.empty()) error = message;
  return false;
}

std::uint8_t TypeWidth(std::uint16_t type) {
  switch (type) {
    case 1:  // BYTE
    case 2:  // ASCII
    case 6:  // SBYTE
    case 7:  // UNDEFINED
      return 1;
    case 3:  // SHORT
    case 8:  // SSHORT
      return 2;
    case 4:  // LONG
    case 9:  // SLONG
    case 11:  // FLOAT
    case 13:  // IFD, TIFF Technical Note 1
      return 4;
    case 5:  // RATIONAL
    case 10:  // SRATIONAL
    case 12:  // DOUBLE
      return 8;
    default:
      return 0;
  }
}

const Field* FindField(const Directory& directory, std::uint16_t tag) {
  for (const auto& field : directory.fields) {
    if (field.tag == tag) return &field;
  }
  return nullptr;
}

bool ReadUnsignedValue(const Context& context, const Field& field,
                       std::uint32_t index, std::uint64_t* value) {
  if (value == nullptr || index >= field.count ||
      (field.type != 3 && field.type != 4 && field.type != 13)) {
    return false;
  }
  const std::uint64_t stride = field.type == 3 ? 2 : 4;
  const std::uint64_t offset =
      static_cast<std::uint64_t>(field.data_offset) + stride * index;
  if (field.type == 3) {
    std::uint16_t read = 0;
    if (!context.Read16(offset, &read)) return false;
    *value = read;
    return true;
  }
  std::uint32_t read = 0;
  if (!context.Read32(offset, &read)) return false;
  *value = read;
  return true;
}

bool ParseDirectory(Context* context, std::uint32_t offset,
                    Directory* directory) {
  if (context == nullptr || directory == nullptr) return false;
  if (offset < 8 || (offset & 1u) != 0) {
    return context->Fail("TIFF IFD offset is invalid or unaligned");
  }
  std::uint16_t count = 0;
  if (!context->Read16(offset, &count)) {
    return context->Fail("TIFF IFD entry count is truncated");
  }
  if (count == 0) return context->Fail("TIFF IFD must contain an entry");
  if (count > kMaximumTiffIfdEntries - context->total_entries) {
    return context->Fail("TIFF contains too many IFD entries");
  }
  const std::uint64_t entry_bytes = static_cast<std::uint64_t>(count) * 12;
  if (entry_bytes > std::numeric_limits<std::uint64_t>::max() - 6 ||
      !context->Include(offset, 2 + entry_bytes + 4)) {
    return context->Fail("TIFF IFD structure is truncated");
  }

  Directory parsed;
  parsed.offset = offset;
  parsed.fields.reserve(count);
  std::unordered_set<std::uint16_t> tags;
  tags.reserve(count);
  const std::uint64_t entries_start = static_cast<std::uint64_t>(offset) + 2;
  // TIFF 6.0 writers order fields by tag. This bounded analyzer validates
  // extents and graph references but accepts other entry orders for interop.
  for (std::uint32_t index = 0; index < count; ++index) {
    const std::uint64_t entry_offset = entries_start + index * 12ull;
    Field field;
    std::uint32_t value_count = 0;
    if (!context->Read16(entry_offset, &field.tag) ||
        !context->Read16(entry_offset + 2, &field.type) ||
        !context->Read32(entry_offset + 4, &value_count)) {
      return context->Fail("TIFF IFD entry is truncated");
    }
    const std::uint8_t type_width = TypeWidth(field.type);
    if (type_width == 0) {
      return context->Fail("TIFF field uses an unknown data type");
    }
    if (value_count == 0) {
      return context->Fail("TIFF field has a zero value count");
    }
    if (!tags.insert(field.tag).second) {
      return context->Fail("TIFF IFD contains a duplicate tag");
    }
    if (static_cast<std::uint64_t>(value_count) >
        std::numeric_limits<std::uint64_t>::max() / type_width) {
      return context->Fail("TIFF field byte count overflows");
    }
    field.count = value_count;
    field.byte_length = static_cast<std::uint64_t>(value_count) * type_width;
    field.value_location = static_cast<std::size_t>(entry_offset + 8);
    if (field.byte_length <= 4) {
      field.data_offset = field.value_location;
    } else {
      std::uint32_t external_offset = 0;
      if (!context->Read32(field.value_location, &external_offset) ||
          (external_offset & 1u) != 0) {
        return context->Fail("TIFF field value offset is invalid or unaligned");
      }
      field.data_offset = external_offset;
      if (external_offset < 8 ||
          !context->Include(field.data_offset, field.byte_length)) {
        return context->Fail("TIFF field payload points outside value storage");
      }
    }
    parsed.fields.push_back(field);
  }

  const std::uint64_t next_location = entries_start + entry_bytes;
  if (!context->Read32(next_location, &parsed.next_offset)) {
    return context->Fail("TIFF IFD next-offset field is truncated");
  }
  context->total_entries += count;
  *directory = std::move(parsed);
  return true;
}

}  // namespace clipboard_codecs::tiff_internal
