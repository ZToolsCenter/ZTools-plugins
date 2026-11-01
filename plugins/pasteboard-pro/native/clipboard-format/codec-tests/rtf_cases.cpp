#include "rtf_cases.h"

#include "../common/clipboard_rtf.h"

#include <cstdint>
#include <iostream>
#include <string_view>
#include <vector>

namespace {

struct TestRunner {
  int failed = 0;

  void Check(bool condition, const char* id) {
    std::cout << (condition ? "PASS " : "FAIL ") << id << '\n';
    if (!condition) ++failed;
  }
};

std::vector<std::uint8_t> Bytes(std::string_view text) {
  return std::vector<std::uint8_t>(text.begin(), text.end());
}

bool RejectsAndClears(const std::vector<std::uint8_t>& bytes) {
  clipboard_format_probe::RtfFraming framing{11, 19};
  return !clipboard_format_probe::AnalyzeRtfFraming(
             bytes.data(), bytes.size(), &framing) &&
         framing.root_end == 0 && framing.logical_length == 0;
}

}  // namespace

int RunRtfCases() {
  TestRunner tests;
  using clipboard_format_probe::AnalyzeRtfFraming;
  using clipboard_format_probe::RtfFraming;

  RtfFraming invalid_argument_layout{3, 5};
  tests.Check(!AnalyzeRtfFraming(nullptr, 0, &invalid_argument_layout) &&
                  invalid_argument_layout.root_end == 0 &&
                  invalid_argument_layout.logical_length == 0,
              "rtf-invalid-input-clears-output");

  const auto formatted = Bytes(
      R"({\rtf1\ansi\deff0{\fonttbl{\f0\fnil\fcharset0 Arial;}})"
      R"(\viewkind4\uc1 Unicode \u-12345? and \{escaped\} \\slash \'e9})");
  RtfFraming formatted_layout;
  tests.Check(AnalyzeRtfFraming(formatted.data(), formatted.size(),
                                &formatted_layout) &&
                  formatted_layout.root_end == formatted.size() &&
                  formatted_layout.logical_length == formatted.size(),
              "rtf-formatting-unicode-escapes-and-groups");

  auto binary = Bytes(R"({\rtf1\bin4 )");
  binary.insert(binary.end(), {'{', 0, '}', '\\'});
  binary.push_back('}');
  RtfFraming binary_layout;
  tests.Check(AnalyzeRtfFraming(binary.data(), binary.size(), &binary_layout) &&
                  binary_layout.root_end == binary.size() &&
                  binary_layout.logical_length == binary.size(),
              "rtf-bin-consumes-exact-raw-bytes-including-nul-and-braces");

  const auto bad_hex = Bytes(R"({\rtf1\'g0})");
  const auto short_hex = Bytes(R"({\rtf1\'a})");
  tests.Check(RejectsAndClears(bad_hex) && RejectsAndClears(short_hex),
              "rtf-malformed-or-truncated-hex-escape-rejected");

  const auto truncated_root = Bytes(R"({\rtf1)");
  const auto wrong_version = Bytes(R"({\rtf2})");
  const auto version_ten = Bytes(R"({\rtf10})");
  const auto leading_zero_version = Bytes(R"({\rtf01})");
  const auto missing_version = Bytes(R"({\rtf})");
  const auto wrong_root_word = Bytes(R"({\rtfx})");
  const auto missing_root_delimiter = Bytes(R"({\rtf1x})");
  tests.Check(RejectsAndClears(truncated_root) &&
                  RejectsAndClears(wrong_version) &&
                  RejectsAndClears(version_ten) &&
                  RejectsAndClears(leading_zero_version) &&
                  RejectsAndClears(missing_version) &&
                  RejectsAndClears(wrong_root_word) &&
                  RejectsAndClears(missing_root_delimiter),
              "rtf-root-version-and-delimiter-required");

  auto long_control_word = Bytes(R"({\rtf1\)");
  long_control_word.insert(long_control_word.end(), 33, 'a');
  long_control_word.push_back('}');
  const auto overflowing_parameter = Bytes(R"({\rtf1\custom2147483648})");
  const auto underflowing_parameter = Bytes(R"({\rtf1\custom-2147483649})");
  tests.Check(RejectsAndClears(long_control_word) &&
                  RejectsAndClears(overflowing_parameter) &&
                  RejectsAndClears(underflowing_parameter),
              "rtf-control-word-and-signed-parameter-limits");

  const auto signed_minimum = Bytes(R"({\rtf1\custom-2147483648})");
  const auto signed_maximum = Bytes(R"({\rtf1\custom2147483647})");
  RtfFraming signed_layout;
  tests.Check(AnalyzeRtfFraming(signed_minimum.data(), signed_minimum.size(),
                                &signed_layout) &&
                  AnalyzeRtfFraming(signed_maximum.data(), signed_maximum.size(),
                                    &signed_layout),
              "rtf-signed-32-bit-parameter-boundaries-accepted");

  std::vector<std::uint8_t> depth_128 = Bytes(R"({\rtf1)");
  depth_128.insert(depth_128.end(), 127, '{');
  depth_128.insert(depth_128.end(), 128, '}');
  std::vector<std::uint8_t> depth_129 = Bytes(R"({\rtf1)");
  depth_129.insert(depth_129.end(), 128, '{');
  depth_129.insert(depth_129.end(), 129, '}');
  RtfFraming depth_layout;
  tests.Check(AnalyzeRtfFraming(depth_128.data(), depth_128.size(),
                                &depth_layout) &&
                  depth_layout.root_end == depth_128.size() &&
                  RejectsAndClears(depth_129),
              "rtf-group-depth-128-accepted-129-rejected");

  const auto missing_bin_parameter = Bytes(R"({\rtf1\bin })");
  const auto negative_bin_parameter = Bytes(R"({\rtf1\bin-1 x})");
  const auto negative_zero_bin_parameter = Bytes(R"({\rtf1\bin-0})");
  const auto oversized_bin = Bytes(R"({\rtf1\bin5 abc})");
  tests.Check(RejectsAndClears(missing_bin_parameter) &&
                  RejectsAndClears(negative_bin_parameter) &&
                  RejectsAndClears(negative_zero_bin_parameter) &&
                  RejectsAndClears(oversized_bin),
              "rtf-bin-requires-nonnegative-in-range-length");

  auto whitespace_and_padding = Bytes(R"({\rtf1} )");
  whitespace_and_padding.insert(whitespace_and_padding.end(),
                                {'\t', '\r', '\n'});
  const std::size_t expected_logical = whitespace_and_padding.size();
  whitespace_and_padding.insert(whitespace_and_padding.end(), 4, 0);
  RtfFraming padded_layout;
  tests.Check(AnalyzeRtfFraming(whitespace_and_padding.data(),
                                whitespace_and_padding.size(),
                                &padded_layout) &&
                  padded_layout.root_end == 7 &&
                  padded_layout.logical_length == expected_logical,
              "rtf-ascii-whitespace-retained-and-zero-tail-trimmed");

  auto ambiguous_tail = Bytes(R"({\rtf1}x)");
  const auto second_root = Bytes(R"({\rtf1}{\rtf1})");
  auto nul_outside_binary = Bytes(R"({\rtf1})");
  nul_outside_binary.insert(nul_outside_binary.end() - 1, 0);
  auto nonzero_after_padding = Bytes(R"({\rtf1})");
  nonzero_after_padding.push_back(0);
  nonzero_after_padding.push_back(' ');
  tests.Check(RejectsAndClears(ambiguous_tail) &&
                  RejectsAndClears(second_root) &&
                  RejectsAndClears(nul_outside_binary) &&
                  RejectsAndClears(nonzero_after_padding),
              "rtf-nonzero-or-ambiguous-tail-rejected");

  auto allocation = Bytes(R"({\rtf1})");
  allocation.resize(clipboard_format_probe::kMaximumRtfFramingBytes, 0);
  RtfFraming allocation_layout;
  const bool accepted_limit =
      AnalyzeRtfFraming(allocation.data(), allocation.size(),
                        &allocation_layout) &&
      allocation_layout.root_end == 7 && allocation_layout.logical_length == 7;
  allocation.push_back(0);
  tests.Check(accepted_limit &&
                  RejectsAndClears(allocation),
              "rtf-10-mib-raw-allocation-limit");

  return tests.failed;
}
