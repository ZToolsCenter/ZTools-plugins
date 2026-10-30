#include "clipboard_format_receipts.h"

#include <string_view>

namespace clipboard_format_probe {
namespace {

void AppendQuoted(std::string_view value, std::string* output) {
  constexpr char kHex[] = "0123456789abcdef";
  output->push_back('"');
  for (const unsigned char character : value) {
    switch (character) {
      case '"':
        output->append("\\\"");
        break;
      case '\\':
        output->append("\\\\");
        break;
      case '\b':
        output->append("\\b");
        break;
      case '\f':
        output->append("\\f");
        break;
      case '\n':
        output->append("\\n");
        break;
      case '\r':
        output->append("\\r");
        break;
      case '\t':
        output->append("\\t");
        break;
      default:
        if (character < 0x20) {
          output->append("\\u00");
          output->push_back(kHex[character >> 4]);
          output->push_back(kHex[character & 0x0F]);
        } else {
          output->push_back(static_cast<char>(character));
        }
        break;
    }
  }
  output->push_back('"');
}

void AppendNumber(std::uint64_t value, std::string* output) {
  output->append(std::to_string(value));
}

void AppendSummary(const ReceiptByteSummary& summary, std::string* output) {
  output->append("{\"byteLength\":");
  AppendNumber(summary.byte_length, output);
  output->append(",\"sha256\":");
  AppendQuoted(summary.sha256, output);
  output->push_back('}');
}

void AppendEvidence(const WindowsFormatEvidence& evidence, std::string* output) {
  output->append("{\"key\":");
  AppendQuoted(evidence.key, output);
  output->append(",\"nativeName\":");
  AppendQuoted(evidence.native_name, output);
  output->append(",\"codec\":");
  AppendQuoted(evidence.codec, output);
  output->append(",\"encoding\":");
  AppendQuoted(evidence.encoding, output);
  output->append(",\"fidelity\":");
  AppendQuoted(evidence.fidelity, output);
  output->append(",\"materialization\":");
  AppendQuoted(evidence.materialization, output);
  output->append(",\"planned\":");
  AppendSummary(evidence.planned, output);
  output->append(",\"readback\":");
  AppendSummary(evidence.readback, output);
  output->append(",\"comparison\":");
  AppendQuoted(evidence.comparison, output);
  if (evidence.validation_code_page.has_value()) {
    output->append(",\"validationCodePage\":");
    AppendNumber(*evidence.validation_code_page, output);
  }
  if (evidence.url_code_page.has_value()) {
    output->append(",\"urlCodePage\":");
    AppendNumber(*evidence.url_code_page, output);
  }
  output->push_back('}');
}

void AppendReceipt(const WindowsRoundTripReceipt& receipt, std::string* output) {
  output->append("{\"caseId\":");
  AppendQuoted(receipt.case_id, output);
  output->append(",\"sourceRevision\":");
  AppendNumber(receipt.source_revision, output);
  output->append(",\"expectedRevision\":");
  AppendNumber(receipt.expected_revision, output);
  output->append(",\"writeRevision\":");
  AppendNumber(receipt.write_revision, output);
  output->append(",\"readbackRevision\":");
  AppendNumber(receipt.readback_revision, output);
  output->append(",\"observedRevision\":");
  AppendNumber(receipt.observed_revision, output);
  output->append(",\"helperCodePage\":");
  AppendNumber(receipt.helper_code_page, output);
  output->append(",\"helperOemCodePage\":");
  AppendNumber(receipt.helper_oem_code_page, output);
  output->append(",\"sourceOrigin\":\"unknown\",\"formats\":[");
  for (std::size_t i = 0; i < receipt.formats.size(); ++i) {
    if (i != 0) output->push_back(',');
    AppendEvidence(receipt.formats[i], output);
  }
  output->append("]}");
}

}  // namespace

std::string SerializeWindowsFormatReceipts(
    const std::vector<WindowsRoundTripReceipt>& receipts) {
  if (receipts.size() > 7) return "[]";
  try {
    for (std::size_t i = 0; i < receipts.size(); ++i) {
      if (!receipt_detail::IsWindowsRoundTripReceiptValid(receipts[i], true)) {
        return "[]";
      }
      for (std::size_t j = i + 1; j < receipts.size(); ++j) {
        if (receipts[i].case_id == receipts[j].case_id) return "[]";
      }
    }

    std::string output;
    output.push_back('[');
    for (std::size_t i = 0; i < receipts.size(); ++i) {
      if (i != 0) output.push_back(',');
      AppendReceipt(receipts[i], &output);
    }
    output.push_back(']');
    return output;
  } catch (...) {
    return "[]";
  }
}

bool WindowsFormatReceiptsComplete(
    const std::vector<WindowsRoundTripReceipt>& receipts) {
  if (receipts.size() != 7) return false;
  try {
    for (std::size_t i = 0; i < receipts.size(); ++i) {
      if (!receipt_detail::IsWindowsRoundTripReceiptValid(receipts[i], true)) {
        return false;
      }
      for (std::size_t j = i + 1; j < receipts.size(); ++j) {
        if (receipts[i].case_id == receipts[j].case_id) return false;
      }
    }
    return true;
  } catch (...) {
    return false;
  }
}

}  // namespace clipboard_format_probe
