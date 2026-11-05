#pragma once

#include "clipboard_tiff.h"

#include <cstddef>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace clipboard_codecs::tiff_internal {

inline constexpr std::size_t kMaximumTiffIfdEntries = 262144;
inline constexpr std::size_t kMaximumTiffIfdEdges = 4096;

struct Field {
  std::uint16_t tag = 0;
  std::uint16_t type = 0;
  std::uint32_t count = 0;
  std::uint64_t byte_length = 0;
  std::size_t value_location = 0;
  std::size_t data_offset = 0;
};

struct Directory {
  std::uint32_t offset = 0;
  std::uint32_t next_offset = 0;
  std::vector<Field> fields;
};

struct Context {
  const std::uint8_t* bytes = nullptr;
  std::size_t size = 0;
  bool big_endian = false;
  std::size_t logical_end = 0;
  std::size_t total_entries = 0;
  std::size_t total_edges = 0;
  std::string error;
  std::unordered_map<std::uint32_t, Directory> directories;
  std::unordered_map<std::uint32_t, std::uint8_t> colors;

  bool Read16(std::uint64_t offset, std::uint16_t* value) const;
  bool Read32(std::uint64_t offset, std::uint32_t* value) const;
  bool IsRange(std::uint64_t offset, std::uint64_t length) const;
  bool Include(std::uint64_t offset, std::uint64_t length);
  bool Fail(const char* message);
};

std::uint8_t TypeWidth(std::uint16_t type);
const Field* FindField(const Directory& directory, std::uint16_t tag);
bool ReadUnsignedValue(const Context& context, const Field& field,
                       std::uint32_t index, std::uint64_t* value);
bool ParseDirectory(Context* context, std::uint32_t offset,
                    Directory* directory);
bool VisitIfdGraph(Context* context, std::uint32_t offset,
                   std::size_t depth);
bool ValidateImageDirectory(Context* context, const Directory& directory,
                            bool require_image, TiffFrameLayout* frame,
                            std::uint64_t* native_expanded_bytes);

}  // namespace clipboard_codecs::tiff_internal
