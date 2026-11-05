#include "clipboard_capture_codec.h"

#include <cstdint>

namespace clipboard_format_probe {
namespace {

bool IsCodecIdentifier(const std::string& value) {
  if (value.empty() || value.size() > 128) return false;
  for (const unsigned char byte : value) {
    const bool alphanumeric = (byte >= 'a' && byte <= 'z') ||
                              (byte >= 'A' && byte <= 'Z') ||
                              (byte >= '0' && byte <= '9');
    if (!alphanumeric && byte != '.' && byte != '_' && byte != ':' &&
        byte != '-') {
      return false;
    }
  }
  return true;
}

void AppendQuoted(std::string* output, const std::string& value) {
  output->push_back('"');
  for (const unsigned char byte : value) {
    switch (byte) {
      case '"': output->append("\\\""); break;
      case '\\': output->append("\\\\"); break;
      case '\b': output->append("\\b"); break;
      case '\f': output->append("\\f"); break;
      case '\n': output->append("\\n"); break;
      case '\r': output->append("\\r"); break;
      case '\t': output->append("\\t"); break;
      default:
        if (byte < 0x20) {
          constexpr char kHex[] = "0123456789abcdef";
          output->append("\\u00");
          output->push_back(kHex[byte >> 4]);
          output->push_back(kHex[byte & 0x0f]);
        } else {
          output->push_back(static_cast<char>(byte));
        }
    }
  }
  output->push_back('"');
}

bool HasUtf16Bom(const std::uint8_t* bytes, std::size_t byte_length) {
  return byte_length >= 2 &&
      ((bytes[0] == 0xff && bytes[1] == 0xfe) ||
       (bytes[0] == 0xfe && bytes[1] == 0xff));
}

bool HasExpectedUtf16Bom(const std::string& encoding,
                         const std::uint8_t* bytes,
                         std::size_t byte_length) {
  if (byte_length < 2) return false;
  if (encoding == "utf-16le") return bytes[0] == 0xff && bytes[1] == 0xfe;
  if (encoding == "utf-16be") return bytes[0] == 0xfe && bytes[1] == 0xff;
  return false;
}

bool HasUtf16Terminator(const std::string& encoding,
                        const std::uint8_t* bytes,
                        std::size_t byte_length) {
  if (byte_length < 2) return false;
  if (encoding == "utf-16le") {
    return bytes[byte_length - 2] == 0 && bytes[byte_length - 1] == 0;
  }
  if (encoding == "utf-16be") {
    return bytes[byte_length - 2] == 0 && bytes[byte_length - 1] == 0;
  }
  return false;
}

}  // namespace

bool ValidateCaptureCodecV2(const CaptureCodecV2& codec,
                            const std::string& platform,
                            const std::string& native_name,
                            const std::string& derived_from,
                            const std::string& fidelity,
                            const std::uint8_t* bytes,
                            std::size_t byte_length) {
  if (!IsCodecIdentifier(codec.encoding) ||
      !IsCodecIdentifier(codec.materialization) ||
      (!bytes && byte_length != 0)) {
    return false;
  }
  if (codec.validation_code_page &&
      (platform != "windows" || *codec.validation_code_page == 0 ||
       *codec.validation_code_page > 65535)) {
    return false;
  }
  const bool mac_external_utf16 =
      platform == "macos" &&
      native_name == "public.utf16-external-plain-text";
  if (mac_external_utf16) {
    if (!codec.text) {
      if (fidelity != "exact" || !derived_from.empty()) return false;
    } else if (fidelity != "compatible" ||
               derived_from != "public.utf8-plain-text") {
      return false;
    }
  }
  if (!codec.text) return true;

  const CaptureTextEvidenceV2& text = *codec.text;
  if (platform != "macos" ||
      native_name != "public.utf16-external-plain-text" ||
      derived_from != "public.utf8-plain-text" ||
      (text.encoding != "utf-16le" && text.encoding != "utf-16be") ||
      (text.encoding_check != "decoded-text-matches" &&
       text.encoding_check != "canonical-unicode-equivalent") ||
      byte_length % 2 != 0) {
    return false;
  }

  const bool has_bom = HasUtf16Bom(bytes, byte_length);
  if (text.byte_order_mark != has_bom ||
      (has_bom && !HasExpectedUtf16Bom(text.encoding, bytes, byte_length))) {
    return false;
  }
  const std::size_t payload_after_bom = byte_length - (has_bom ? 2 : 0);
  if (payload_after_bom < 2) return false;
  if (text.null_terminated &&
      !HasUtf16Terminator(text.encoding, bytes, byte_length)) {
    return false;
  }
  return true;
}

void AppendCaptureCodecV2Json(std::string* output,
                              const CaptureCodecV2& codec) {
  output->append("{\"encoding\":");
  AppendQuoted(output, codec.encoding);
  output->append(",\"materialization\":");
  AppendQuoted(output, codec.materialization);
  if (codec.validation_code_page) {
    output->append(",\"validationCodePage\":");
    output->append(std::to_string(*codec.validation_code_page));
  }
  if (codec.text) {
    output->append(",\"text\":{\"encoding\":");
    AppendQuoted(output, codec.text->encoding);
    output->append(",\"byteOrderMark\":");
    output->append(codec.text->byte_order_mark ? "true" : "false");
    output->append(",\"nullTerminated\":");
    output->append(codec.text->null_terminated ? "true" : "false");
    output->append(",\"encodingCheck\":");
    AppendQuoted(output, codec.text->encoding_check);
    output->append("}");
  }
  output->push_back('}');
}

}  // namespace clipboard_format_probe
