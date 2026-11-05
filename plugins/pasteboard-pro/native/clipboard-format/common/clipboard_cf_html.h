#pragma once

#include <cstddef>
#include <cstdint>

namespace clipboard_format_probe {

inline constexpr std::size_t kMaximumCfHtmlBytes = 8 * 1024 * 1024;
inline constexpr std::size_t kMaximumCfHtmlHeaderBytes = 4096;
inline constexpr std::size_t kMaximumCfHtmlHeaderLines = 128;

struct CfHtmlLayout {
  std::size_t header_bytes = 0;
  std::size_t start_html = 0;
  std::size_t end_html = 0;
  std::size_t start_fragment = 0;
  std::size_t end_fragment = 0;
  std::size_t logical_bytes = 0;
  bool has_context = false;
};

// Validates bounded CF_HTML framing and UTF-8 byte offsets. It does not parse
// HTML semantics, fetch SourceURL, or establish content privacy.
bool AnalyzeCfHtml(const std::uint8_t* bytes, std::size_t size,
                   CfHtmlLayout* layout) noexcept;

}  // namespace clipboard_format_probe
