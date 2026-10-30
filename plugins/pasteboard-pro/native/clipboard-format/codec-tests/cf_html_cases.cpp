#include "cf_html_cases.h"

#include "../common/clipboard_cf_html.h"

#include <cstddef>
#include <cstdint>
#include <iostream>
#include <limits>
#include <string>
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

std::string PaddedOffset(std::size_t value) {
  std::string digits = std::to_string(value);
  return std::string(10 - digits.size(), '0') + digits;
}

void ReplaceOffset(std::string* header, std::string_view name,
                   std::size_t value) {
  const std::string prefix = std::string(name) + ":";
  const std::size_t start = header->find(prefix);
  header->replace(start + prefix.size(), 10, PaddedOffset(value));
}

std::vector<std::uint8_t> ContextPayload(std::string_view eol = "\r\n",
                                         std::string_view version = "1.0",
                                         bool selection = false,
                                         bool source_url = false,
                                         std::string_view extra_header = {}) {
  std::string header = "Version:" + std::string(version) + std::string(eol) +
      "StartHTML:0000000000" + std::string(eol) +
      "EndHTML:0000000000" + std::string(eol) +
      "StartFragment:0000000000" + std::string(eol) +
      "EndFragment:0000000000" + std::string(eol);
  if (selection) {
    header += "StartSelection:0000000000" + std::string(eol) +
              "EndSelection:0000000000" + std::string(eol);
  }
  if (source_url) header += "SourceURL:https%3A%2F%2Fexample.test" + std::string(eol);
  if (!extra_header.empty()) header += std::string(extra_header) + std::string(eol);

  const std::size_t start_html = header.size();
  const std::string prefix = "<html><body>";
  const std::string middle = "<p>safe fragment</p>";
  const std::string suffix = "</body></html>";
  const std::size_t start_marker = start_html + prefix.size();
  const std::size_t start_fragment = start_marker + std::string_view("<!--StartFragment-->").size();
  const std::size_t end_fragment = start_fragment + middle.size();
  const std::size_t end_html = start_html + prefix.size() +
      std::string_view("<!--StartFragment-->").size() + middle.size() +
      std::string_view("<!--EndFragment-->").size() + suffix.size();

  ReplaceOffset(&header, "StartHTML", start_html);
  ReplaceOffset(&header, "EndHTML", end_html);
  ReplaceOffset(&header, "StartFragment", start_fragment);
  ReplaceOffset(&header, "EndFragment", end_fragment);
  if (selection) {
    ReplaceOffset(&header, "StartSelection", start_fragment + 4);
    ReplaceOffset(&header, "EndSelection", start_fragment + 9);
  }
  const std::string body = prefix + "<!--StartFragment-->" + middle +
      "<!--EndFragment-->" + suffix;
  header += body;
  return Bytes(header);
}

std::vector<std::uint8_t> HeaderLineBoundaryPayload(std::size_t field_count,
                                                        bool blank_separator) {
  std::string header =
      "Version:1.0\nStartHTML:0000000000\nEndHTML:0000000000\n"
      "StartFragment:0000000000\nEndFragment:0000000000\n";
  constexpr std::size_t kRequiredFields = 5;
  if (field_count < kRequiredFields) return {};
  for (std::size_t index = kRequiredFields; index < field_count; ++index) {
    header += "X-" + std::to_string(index) + ":v\n";
  }
  if (blank_separator) header += "\n";

  const std::size_t start_html = header.size();
  const std::string body = "<html><!--StartFragment-->x<!--EndFragment--></html>";
  const std::size_t start_fragment = start_html + 6 +
      std::string_view("<!--StartFragment-->").size();
  const std::size_t end_fragment = start_fragment + 1;
  const std::size_t end_html = start_html + body.size();
  ReplaceOffset(&header, "StartHTML", start_html);
  ReplaceOffset(&header, "EndHTML", end_html);
  ReplaceOffset(&header, "StartFragment", start_fragment);
  ReplaceOffset(&header, "EndFragment", end_fragment);
  return Bytes(header + body);
}

std::vector<std::uint8_t> NoContextPayload(bool markers) {
  std::string header =
      "Version:0.9\nStartHTML:-1\nEndHTML:-1\n"
      "StartFragment:0000000000\nEndFragment:0000000000\n";
  std::string body = markers
      ? "<!--StartFragment--><b>fragment</b><!--EndFragment-->"
      : "<b>fragment</b>";
  const std::size_t start_fragment = header.size() +
      (markers ? std::string_view("<!--StartFragment-->").size() : 0);
  const std::size_t end_fragment = start_fragment +
      std::string_view("<b>fragment</b>").size();
  ReplaceOffset(&header, "StartFragment", start_fragment);
  ReplaceOffset(&header, "EndFragment", end_fragment);
  return Bytes(header + body);
}

bool RejectsAndClears(const std::vector<std::uint8_t>& bytes) {
  clipboard_format_probe::CfHtmlLayout layout{1, 2, 3, 4, 5, 6, true};
  return !clipboard_format_probe::AnalyzeCfHtml(bytes.data(), bytes.size(), &layout) &&
         layout.header_bytes == 0 && layout.start_html == 0 &&
         layout.end_html == 0 && layout.start_fragment == 0 &&
         layout.end_fragment == 0 && layout.logical_bytes == 0 &&
         !layout.has_context;
}

std::string AsString(const std::vector<std::uint8_t>& bytes) {
  return std::string(bytes.begin(), bytes.end());
}

}  // namespace

int RunCfHtmlCases() {
  TestRunner tests;
  using clipboard_format_probe::AnalyzeCfHtml;
  using clipboard_format_probe::CfHtmlLayout;

  CfHtmlLayout invalid_argument_layout{1, 2, 3, 4, 5, 6, true};
  tests.Check(!AnalyzeCfHtml(nullptr, 0, &invalid_argument_layout) &&
                  invalid_argument_layout.header_bytes == 0 &&
                  invalid_argument_layout.logical_bytes == 0 &&
                  !invalid_argument_layout.has_context,
              "cf-html-invalid-input-clears-output");

  auto valid = ContextPayload("\r\n", "1.0", true, true, "Unknown-Test:ok");
  CfHtmlLayout layout;
  tests.Check(AnalyzeCfHtml(valid.data(), valid.size(), &layout) &&
                  layout.has_context && layout.header_bytes < layout.start_fragment &&
                  layout.start_html == layout.header_bytes &&
                  layout.end_fragment < layout.end_html &&
                  layout.logical_bytes == valid.size(),
              "cf-html-context-selection-sourceurl-and-bounded-unknown-header");

  auto lone_cr = ContextPayload("\r", "0.9");
  auto lone_lf = ContextPayload("\n", "1.0");
  tests.Check(AnalyzeCfHtml(lone_cr.data(), lone_cr.size(), &layout) &&
                  AnalyzeCfHtml(lone_lf.data(), lone_lf.size(), &layout),
              "cf-html-version-and-cr-lf-line-endings");

  auto no_context = NoContextPayload(false);
  auto no_context_markers = NoContextPayload(true);
  tests.Check(AnalyzeCfHtml(no_context.data(), no_context.size(), &layout) &&
                  !layout.has_context && layout.header_bytes == layout.start_fragment &&
                  AnalyzeCfHtml(no_context_markers.data(), no_context_markers.size(), &layout) &&
                  !layout.has_context && layout.logical_bytes == no_context_markers.size(),
              "cf-html-no-context-with-or-without-paired-markers");

  auto whitespace_tail = valid;
  whitespace_tail.insert(whitespace_tail.end(), {' ', '\t', '\r', '\n'});
  const std::size_t whitespace_size = whitespace_tail.size();
  whitespace_tail.insert(whitespace_tail.end(), 3, 0);
  tests.Check(AnalyzeCfHtml(whitespace_tail.data(), whitespace_tail.size(), &layout) &&
                  layout.logical_bytes == whitespace_size,
              "cf-html-retains-tail-whitespace-and-strips-only-allocation-zeros");

  const auto header_127_lines = HeaderLineBoundaryPayload(127, true);
  const auto header_128_lines = HeaderLineBoundaryPayload(128, true);
  tests.Check(AnalyzeCfHtml(header_127_lines.data(), header_127_lines.size(), &layout) &&
                  RejectsAndClears(header_128_lines),
              "cf-html-blank-separator-counts-toward-128-header-lines");

  auto bad_version = valid;
  const std::size_t version = AsString(bad_version).find("Version:1.0");
  bad_version[version + 8] = '2';
  const std::string duplicate_header =
      "Version:1.0\nStartHTML:0000000000\nEndHTML:0000000000\n"
      "StartFragment:0000000000\nEndFragment:0000000000\nstarthtml:1\n";
  auto mixed_minus_one = NoContextPayload(false);
  std::string mixed = AsString(mixed_minus_one);
  mixed.replace(mixed.find("EndHTML:-1"), std::string("EndHTML:-1").size(), "EndHTML:0");
  tests.Check(RejectsAndClears(bad_version) && RejectsAndClears(Bytes(duplicate_header)) &&
                  RejectsAndClears(Bytes("Version:1.1\nStartHTML:0\nEndHTML:0\nStartFragment:0\nEndFragment:0\n")) &&
                  RejectsAndClears(Bytes(mixed)),
              "cf-html-version-duplicate-and-mixed-sentinel-rejected");

  auto malformed_offset = valid;
  const std::size_t offset = AsString(malformed_offset).find("StartHTML:");
  malformed_offset[offset + std::string("StartHTML:").size()] = '1';
  malformed_offset[offset + std::string("StartHTML:").size() + 1] = 'x';
  auto overflowing = valid;
  std::string overflow_header =
      "Version:1.0\nStartHTML:18446744073709551616\nEndHTML:1\n"
      "StartFragment:1\nEndFragment:1\n";
  tests.Check(RejectsAndClears(malformed_offset) && RejectsAndClears(Bytes(overflow_header)),
              "cf-html-offset-junk-and-overflow-rejected");

  auto unpaired_selection = valid;
  const std::string selection_header =
      "Version:1.0\nStartHTML:0\nEndHTML:0\nStartFragment:0\n"
      "EndFragment:0\nStartSelection:0\n";
  unpaired_selection = Bytes(selection_header);
  tests.Check(RejectsAndClears(unpaired_selection),
              "cf-html-selection-offsets-must-be-paired");

  auto wrong_marker = valid;
  const std::size_t marker = AsString(wrong_marker).find("<!--StartFragment-->");
  wrong_marker[marker + 5] = 'X';
  auto hidden_tail = valid;
  hidden_tail.push_back('x');
  auto nonzero_after_padding = valid;
  nonzero_after_padding.push_back(0);
  nonzero_after_padding.push_back(' ');
  tests.Check(RejectsAndClears(wrong_marker) && RejectsAndClears(hidden_tail) &&
                  RejectsAndClears(nonzero_after_padding),
              "cf-html-markers-and-unexplained-tail-rejected");

  auto invalid_utf8 = valid;
  const std::size_t utf8_content = AsString(invalid_utf8).find("safe fragment");
  invalid_utf8[utf8_content] = 0xc0;
  tests.Check(RejectsAndClears(invalid_utf8), "cf-html-invalid-utf8-rejected");

  std::string utf8_payload =
      "Version:1.0\nStartHTML:0000000000\nEndHTML:0000000000\n"
      "StartFragment:0000000000\nEndFragment:0000000000\n"
      "StartSelection:0000000000\nEndSelection:0000000000\n";
  const std::string utf8_body = "<html><!--StartFragment-->a\xc3\xa9z<!--EndFragment--></html>";
  const std::size_t utf8_start_html = utf8_payload.size();
  const std::size_t utf8_start_fragment = utf8_start_html + 6 +
      std::string_view("<!--StartFragment-->").size();
  const std::size_t utf8_end_fragment = utf8_start_fragment + 4;
  const std::size_t utf8_end_html = utf8_start_html + utf8_body.size();
  const std::size_t split_selection = utf8_start_fragment + 2;
  ReplaceOffset(&utf8_payload, "StartHTML", utf8_start_html);
  ReplaceOffset(&utf8_payload, "EndHTML", utf8_end_html);
  ReplaceOffset(&utf8_payload, "StartFragment", utf8_start_fragment);
  ReplaceOffset(&utf8_payload, "EndFragment", utf8_end_fragment);
  ReplaceOffset(&utf8_payload, "StartSelection", split_selection);
  ReplaceOffset(&utf8_payload, "EndSelection", split_selection);
  utf8_payload += utf8_body;
  auto utf8_bytes = Bytes(utf8_payload);
  tests.Check(RejectsAndClears(utf8_bytes),
              "cf-html-selection-offset-may-not-split-utf8-codepoint");

  auto maximum = NoContextPayload(false);
  maximum.resize(clipboard_format_probe::kMaximumCfHtmlBytes, 0);
  const bool accepted_limit = AnalyzeCfHtml(maximum.data(), maximum.size(), &layout) &&
      layout.logical_bytes == NoContextPayload(false).size();
  maximum.push_back(0);
  tests.Check(accepted_limit && RejectsAndClears(maximum),
              "cf-html-8-mib-raw-allocation-limit");

  std::string oversized_header_text = "Version:1.0\nX:";
  oversized_header_text.append(clipboard_format_probe::kMaximumCfHtmlHeaderBytes, 'a');
  oversized_header_text += "\n";
  tests.Check(RejectsAndClears(Bytes(oversized_header_text)), "cf-html-header-byte-limit");

  std::string many_lines = "Version:1.0\n";
  for (std::size_t index = 0; index < clipboard_format_probe::kMaximumCfHtmlHeaderLines; ++index) {
    many_lines += "X-" + std::to_string(index) + ":v\n";
  }
  tests.Check(RejectsAndClears(Bytes(many_lines)), "cf-html-header-line-limit");

  return tests.failed;
}
