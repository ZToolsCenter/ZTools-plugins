#pragma once

#include "clipboard_probe.h"

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace clipboard_format_probe {

struct ReceiptByteSummary {
  std::uint64_t byte_length = 0;
  std::string sha256;
};

struct WindowsFormatEvidence {
  std::string key;
  std::string native_name;
  std::string codec;
  std::string encoding;
  std::string fidelity;
  std::string materialization;
  ReceiptByteSummary planned;
  ReceiptByteSummary readback;
  std::string comparison;
  std::optional<UINT> validation_code_page;
  std::optional<UINT> url_code_page;
};

struct WindowsRoundTripReceipt {
  std::string case_id;
  std::uint32_t source_revision = 0;
  std::uint32_t expected_revision = 0;
  std::uint32_t write_revision = 0;
  std::uint32_t readback_revision = 0;
  std::uint32_t observed_revision = 0;
  UINT helper_code_page = 0;
  UINT helper_oem_code_page = 0;
  std::vector<WindowsFormatEvidence> formats;
};

bool HashWindowsReceiptBytes(const std::uint8_t* bytes, std::size_t size,
                             std::string* sha256);

bool BuildWindowsRoundTripReceipt(
    const std::string& case_id, const ClipboardSnapshot& source,
    const OperationResult& source_result,
    const OperationResult& published, const ClipboardSnapshot& readback,
    const OperationResult& readback_result, WindowsRoundTripReceipt* output);

std::string SerializeWindowsFormatReceipts(
    const std::vector<WindowsRoundTripReceipt>& receipts);
bool WindowsFormatReceiptsComplete(
    const std::vector<WindowsRoundTripReceipt>& receipts);

// Shared validation helpers used by the serializer and completeness check.
// They deliberately accept only the fixed G0 case and format allowlists.
namespace receipt_detail {
bool IsWindowsRoundTripReceiptValid(const WindowsRoundTripReceipt& receipt,
                                    bool require_case_coverage);
}

}  // namespace clipboard_format_probe
