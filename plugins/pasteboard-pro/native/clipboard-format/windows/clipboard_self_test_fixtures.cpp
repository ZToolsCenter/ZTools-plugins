#include "clipboard_self_test_fixtures.h"

#include "../common/clipboard_palette.h"

#include <array>
#include <cstdint>
#include <iomanip>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

namespace clipboard_format_probe::test_fixtures {
namespace {

void Put16(std::vector<std::uint8_t>* bytes, std::size_t offset,
           std::uint16_t value) {
  (*bytes)[offset] = static_cast<std::uint8_t>(value & 0xff);
  (*bytes)[offset + 1] = static_cast<std::uint8_t>(value >> 8);
}

void Put32(std::vector<std::uint8_t>* bytes, std::size_t offset,
           std::uint32_t value) {
  for (std::size_t index = 0; index < 4; ++index) {
    (*bytes)[offset + index] =
        static_cast<std::uint8_t>((value >> (index * 8)) & 0xff);
  }
}

void SetOsFormatMetadata(FormatPayload* format, const char* encoding,
                         const char* source_format) {
  format->encoding = encoding;
  format->fidelity = "representation-bytes-preserved";
  format->source_format = source_format;
  format->source_origin = "unknown";
  format->materialization = "current-clipboard-format-bytes";
}

}  // namespace

FormatPayload MakeDib(UINT id, bool v5) {
  const std::size_t header_size = v5 ? 124 : 40;
  constexpr std::size_t pixel_bytes = 16;
  std::vector<std::uint8_t> bytes(header_size + pixel_bytes, 0);
  Put32(&bytes, 0, static_cast<std::uint32_t>(header_size));
  Put32(&bytes, 4, 2);
  Put32(&bytes, 8, 2);
  Put16(&bytes, 12, 1);
  Put16(&bytes, 14, 32);
  Put32(&bytes, 16, v5 ? 3 : 0);
  Put32(&bytes, 20, pixel_bytes);
  if (v5) {
    Put32(&bytes, 40, 0x00ff0000);
    Put32(&bytes, 44, 0x0000ff00);
    Put32(&bytes, 48, 0x000000ff);
    Put32(&bytes, 52, 0xff000000);
  }
  for (std::size_t index = header_size; index < bytes.size(); ++index) {
    bytes[index] = static_cast<std::uint8_t>(0x10 + index - header_size);
  }
  FormatPayload format{v5 ? "dibv5" : "dib",
                       v5 ? L"CF_DIBV5" : L"CF_DIB", id,
                       std::move(bytes)};
  SetOsFormatMetadata(&format, v5 ? "windows-dibv5" : "windows-dib",
                      v5 ? "CF_DIBV5" : "CF_DIB");
  return format;
}

FormatPayload MakeBitmap(UINT id) {
  auto dib = MakeDib(CF_DIB, false).bytes;
  Put32(&dib, 8, static_cast<std::uint32_t>(-2));
  Put16(&dib, 14, 24);
  FormatPayload format{"bitmap", L"CF_BITMAP", id, std::move(dib)};
  SetOsFormatMetadata(&format, "dib24-rendered", "CF_BITMAP");
  format.fidelity = "visible-rgb-compatible";
  format.materialization = "win32-getdibits-24bpp-top-down";
  return format;
}

FormatPayload MakePalette() {
  std::vector<std::uint8_t> bytes;
  clipboard_codecs::EncodePalette(
      {{255, 0, 0, 0}, {0, 255, 0, 0}, {0, 0, 255, 0}}, &bytes);
  FormatPayload format{"palette", L"CF_PALETTE", CF_PALETTE,
                       std::move(bytes)};
  SetOsFormatMetadata(&format, "logpalette-v0300", "CF_PALETTE");
  format.fidelity = "palette-entries-preserved";
  format.materialization = "win32-getpaletteentries-logpalette-v0300";
  return format;
}

FormatPayload MakeText(UINT id) {
  const std::u16string text = u"Clipboard G0: \u4e2d\u6587 \u2713 \U0001f680";
  FormatPayload format{"text", L"CF_UNICODETEXT", id, {}};
  SetOsFormatMetadata(&format, "utf16le-null-terminated", "CF_UNICODETEXT");
  format.bytes.reserve((text.size() + 1) * 2);
  for (const char16_t unit : text) {
    format.bytes.push_back(static_cast<std::uint8_t>(unit & 0xff));
    format.bytes.push_back(static_cast<std::uint8_t>((unit >> 8) & 0xff));
  }
  format.bytes.push_back(0);
  format.bytes.push_back(0);
  return format;
}

FormatPayload MakeHtml(UINT id) {
  const std::string body =
      "<html><body><!--StartFragment-->Clipboard G0 "
      "\xe4\xb8\xad\xe6\x96\x87<!--EndFragment--></body></html>";
  std::string header =
      "Version:0.9\r\nStartHTML:0000000000\r\nEndHTML:0000000000\r\n"
      "StartFragment:0000000000\r\nEndFragment:0000000000\r\n";
  const std::size_t start_html = header.size();
  const std::size_t end_html = start_html + body.size();
  const std::size_t start_fragment =
      start_html + body.find("Clipboard G0");
  const std::size_t end_fragment =
      start_fragment + body.substr(body.find("Clipboard G0")).find("<!--EndFragment-->");
  const auto patch = [&header](const std::string& field, std::size_t value) {
    const std::size_t offset = header.find(field) + field.size();
    std::ostringstream number;
    number << std::setw(10) << std::setfill('0') << value;
    header.replace(offset, 10, number.str());
  };
  patch("StartHTML:", start_html);
  patch("EndHTML:", end_html);
  patch("StartFragment:", start_fragment);
  patch("EndFragment:", end_fragment);
  FormatPayload format{"html", L"HTML Format", id, {}};
  SetOsFormatMetadata(&format, "cf-html-offset-format", "HTML Format");
  const std::string payload = header + body;
  format.bytes.assign(payload.begin(), payload.end());
  return format;
}

FormatPayload MakeHtmlFragmentOnly(UINT id) {
  const std::string body =
      "<!--StartFragment-->Clipboard G0 "
      "\xe4\xb8\xad\xe6\x96\x87<!--EndFragment-->";
  std::string header =
      "Version:0.9\r\nStartHTML:-1\r\nEndHTML:-1\r\n"
      "StartFragment:0000000000\r\nEndFragment:0000000000\r\n";
  const std::size_t start_fragment =
      header.size() + body.find("Clipboard G0");
  const std::size_t end_fragment =
      header.size() + body.find("<!--EndFragment-->");
  const auto patch = [&header](const std::string& field, std::size_t value) {
    const std::size_t offset = header.find(field) + field.size();
    std::ostringstream number;
    number << std::setw(10) << std::setfill('0') << value;
    header.replace(offset, 10, number.str());
  };
  patch("StartFragment:", start_fragment);
  patch("EndFragment:", end_fragment);
  FormatPayload format{"html", L"HTML Format", id, {}};
  SetOsFormatMetadata(&format, "cf-html-offset-format", "HTML Format");
  const std::string payload = header + body;
  format.bytes.assign(payload.begin(), payload.end());
  return format;
}

FormatPayload MakeRtf(UINT id) {
  const std::string payload = "{\\rtf1\\ansi Clipboard G0 \\u20013?\\u25991? \\{safe\\}}";
  FormatPayload format{"rtf", L"Rich Text Format", id, {}};
  SetOsFormatMetadata(&format, "rtf-bytes", "Rich Text Format");
  format.bytes.assign(payload.begin(), payload.end());
  return format;
}

FormatPayload MakePng(UINT id) {
  constexpr std::array<std::uint8_t, 68> png = {
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x04, 0x00, 0x00, 0x00, 0xb5, 0x1c, 0x0c,
      0x02, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41,
      0x54, 0x78, 0xda, 0x63, 0xfc, 0xff, 0x1f, 0x00,
      0x03, 0x03, 0x02, 0x00, 0xef, 0xa2, 0xa7, 0x5b,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
      0xae, 0x42, 0x60, 0x82};
  FormatPayload format{"png", L"PNG", id,
                       std::vector<std::uint8_t>(png.begin(), png.end())};
  SetOsFormatMetadata(&format, "png-bytes", "PNG");
  return format;
}


}  // namespace clipboard_format_probe::test_fixtures
