#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace clipboard_codecs {

inline constexpr std::size_t kMaximumDibBytes = 20 * 1024 * 1024;
inline constexpr std::size_t kMaximumDropFilesBytes = 20 * 1024 * 1024;

struct DibLayout {
  std::uint32_t width = 0;
  std::uint32_t height = 0;
  std::uint16_t bits_per_pixel = 0;
  std::uint32_t compression = 0;
  std::size_t header_bytes = 0;
  std::size_t pixel_offset = 0;
  std::size_t pixel_bytes = 0;
  std::size_t logical_bytes = 0;
  bool top_down = false;
  bool has_profile = false;
};

struct DropFilesLayout {
  std::size_t files_offset = 0;
  std::size_t logical_bytes = 0;
  std::size_t file_count = 0;
  bool wide = false;
  bool non_client = false;
};

bool AnalyzeDib(const std::uint8_t* bytes, std::size_t size,
                DibLayout* layout, std::string* error = nullptr);
std::optional<std::size_t> LogicalAnsiTextBytes(const std::uint8_t* bytes,
                                               std::size_t size);
bool AnalyzeLocale(const std::uint8_t* bytes, std::size_t size,
                   std::uint32_t* locale_id);
bool AnalyzeDropFiles(const std::uint8_t* bytes, std::size_t size,
                      DropFilesLayout* layout,
                      std::string* error = nullptr);
bool BuildDropFilesWide(const std::vector<std::u16string>& paths,
                        std::vector<std::uint8_t>* bytes);
bool IsValidUtf16(const std::uint8_t* little_endian_bytes,
                  std::size_t byte_length);

}  // namespace clipboard_codecs
