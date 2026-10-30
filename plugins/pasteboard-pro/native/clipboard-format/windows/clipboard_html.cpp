#include "clipboard_html.h"

#include "../common/clipboard_cf_html.h"

namespace clipboard_format_probe {

std::optional<std::size_t> FindHtmlPayloadLength(
    const std::uint8_t* bytes, std::size_t size) {
  CfHtmlLayout layout;
  if (!AnalyzeCfHtml(bytes, size, &layout)) return std::nullopt;
  return layout.logical_bytes;
}

}  // namespace clipboard_format_probe
