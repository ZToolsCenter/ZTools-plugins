#include "url_cases.h"

#include "../common/clipboard_url.h"
#include "../common/clipboard_uri_syntax.h"

#include <algorithm>
#include <cstdint>
#include <iostream>
#include <string>
#include <vector>

namespace {

struct TestRunner {
  int failed = 0;

  void Check(bool condition, const char* case_id) {
    std::cout << (condition ? "PASS " : "FAIL ") << case_id << '\n';
    if (!condition) ++failed;
  }
};

std::vector<std::uint8_t> Utf16Le(std::u16string_view text,
                                  bool terminator = true) {
  std::vector<std::uint8_t> bytes;
  bytes.reserve((text.size() + (terminator ? 1 : 0)) * 2);
  for (const char16_t unit : text) {
    bytes.push_back(static_cast<std::uint8_t>(unit & 0xff));
    bytes.push_back(static_cast<std::uint8_t>(unit >> 8));
  }
  if (terminator) bytes.insert(bytes.end(), {0, 0});
  return bytes;
}

}  // namespace

int RunUrlCases() {
  using namespace clipboard_codecs;
  TestRunner tests;
  UrlLayout layout;
  std::u16string decoded;

  const std::u16string wide_url =
      u"https://例子.invalid/路径?q=%2f%E9%9B%AA#段落";
  const auto wide_bytes = Utf16Le(wide_url);
  tests.Check(AnalyzeUrlUtf16LE(wide_bytes.data(), wide_bytes.size(), &decoded,
                                &layout) &&
                  decoded == wide_url && layout.logical_bytes == wide_bytes.size() &&
                  ValidateUrlText(decoded) == UrlValidationResult::valid,
              "url-wide-original-unicode-and-percent-case-preserved");

  auto padded_wide = wide_bytes;
  padded_wide.insert(padded_wide.end(), {0xa5, 0x7c, 0x00, 0xfe});
  tests.Check(AnalyzeUrlUtf16LE(padded_wide.data(), padded_wide.size(), &decoded,
                                &layout) &&
                  decoded == wide_url && layout.logical_bytes == wide_bytes.size() &&
                  layout.logical_bytes < padded_wide.size(),
              "url-wide-logical-length-excludes-global-padding");

  const std::vector<std::uint8_t> ansi = {
      'h', 't', 't', 'p', 's', ':', '/', '/', 'x', '.', 'i', 'n', 'v', 'a', 'l',
      'i', 'd', '/', 0xe9, 0};
  tests.Check(AnalyzeUrlAnsiBytes(ansi.data(), ansi.size(), &layout) &&
                  layout.logical_bytes == ansi.size() &&
                  layout.content_bytes == ansi.size() - 1,
              "url-ansi-high-byte-retained-with-explicit-external-decoder");
  auto padded_ansi = ansi;
  padded_ansi.insert(padded_ansi.end(), {0x81, 0xff, 0});
  tests.Check(AnalyzeUrlAnsiBytes(padded_ansi.data(), padded_ansi.size(), &layout) &&
                  layout.logical_bytes == ansi.size(),
              "url-ansi-logical-length-excludes-global-padding");

  const std::string ansi_prefix = "myapp://host.invalid/";
  std::vector<std::uint8_t> boundary_ansi(kMaximumUrlBytes, 'a');
  std::copy(ansi_prefix.begin(), ansi_prefix.end(), boundary_ansi.begin());
  boundary_ansi.back() = 0;
  tests.Check(AnalyzeUrlAnsiBytes(boundary_ansi.data(), boundary_ansi.size(),
                                 &layout) &&
                  layout.logical_bytes == kMaximumUrlBytes,
              "url-ansi-64k-logical-boundary-accepted");
  boundary_ansi.insert(boundary_ansi.end() - 1, 'a');
  tests.Check(!AnalyzeUrlAnsiBytes(boundary_ansi.data(), boundary_ansi.size(),
                                  &layout),
              "url-ansi-over-64k-logical-boundary-rejected");
  std::vector<std::uint8_t> maximum_ansi_url(kMaximumUrlBytes, 'a');
  const std::string ansi_scheme = "myapp:";
  std::copy(ansi_scheme.begin(), ansi_scheme.end(), maximum_ansi_url.begin());
  maximum_ansi_url.back() = 0;
  const bool maximum_ansi_analyzed = AnalyzeUrlAnsiBytes(
      maximum_ansi_url.data(), maximum_ansi_url.size(), &layout);
  std::u16string maximum_ansi_decoded;
  if (maximum_ansi_analyzed) {
    maximum_ansi_decoded.reserve(layout.content_bytes);
    for (std::size_t i = 0; i < layout.content_bytes; ++i) {
      maximum_ansi_decoded.push_back(
          static_cast<char16_t>(maximum_ansi_url[i]));
    }
  }
  tests.Check(maximum_ansi_analyzed &&
                  maximum_ansi_decoded.size() == kMaximumUrlBytes - 1 &&
                  ValidateUrlText(maximum_ansi_decoded) ==
                      UrlValidationResult::valid,
              "url-ansi-64k-buffer-decoded-and-validated-at-full-boundary");
  maximum_ansi_decoded.push_back(u'a');
  tests.Check(ValidateUrlText(maximum_ansi_decoded) ==
                  UrlValidationResult::invalid,
              "url-ansi-decoded-over-native-byte-budget-rejected");
  const std::vector<std::uint8_t> missing_terminator = {'h', 't', 't', 'p'};
  tests.Check(!AnalyzeUrlAnsiBytes(missing_terminator.data(),
                                   missing_terminator.size(), &layout),
              "url-ansi-missing-terminator-rejected");

  auto no_wide_terminator = Utf16Le(u"file:///C:/clipboard", false);
  tests.Check(!AnalyzeUrlUtf16LE(no_wide_terminator.data(),
                                 no_wide_terminator.size(), &decoded, &layout),
              "url-wide-missing-terminator-rejected");
  auto odd_wide = wide_bytes;
  odd_wide.push_back(0x7f);
  tests.Check(AnalyzeUrlUtf16LE(odd_wide.data(), odd_wide.size(), &decoded,
                                &layout) &&
                  layout.logical_bytes == wide_bytes.size(),
              "url-wide-odd-allocation-padding-is-not-logical-data");
  std::vector<std::uint8_t> broken_surrogate =
      Utf16Le(u"https://x.invalid/");
  broken_surrogate.resize(broken_surrogate.size() - 2);
  broken_surrogate.insert(broken_surrogate.end(), {0x00, 0xd8, 0x00, 0x00});
  tests.Check(!AnalyzeUrlUtf16LE(broken_surrogate.data(), broken_surrogate.size(),
                                 &decoded, &layout),
              "url-wide-unpaired-surrogate-rejected");

  std::u16string boundary_url = u"myapp://h/";
  boundary_url.resize(kMaximumUrlBytes / 2 - 1, u'a');
  auto boundary_bytes = Utf16Le(boundary_url);
  tests.Check(AnalyzeUrlUtf16LE(boundary_bytes.data(), boundary_bytes.size(),
                                &decoded, &layout) &&
                  layout.logical_bytes == kMaximumUrlBytes &&
                  ValidateUrlText(decoded) == UrlValidationResult::valid,
              "url-wide-64k-logical-boundary-accepted");
  boundary_url.push_back(u'a');
  auto oversized_bytes = Utf16Le(boundary_url);
  tests.Check(!AnalyzeUrlUtf16LE(oversized_bytes.data(), oversized_bytes.size(),
                                 &decoded, &layout),
              "url-wide-over-64k-logical-boundary-rejected");

  tests.Check(ValidateUrlText(u"ftp://user:secret@example.invalid:65536/path") ==
                  UrlValidationResult::valid,
              "url-ftp-userinfo-and-generic-port-preserved");
  tests.Check(ValidateUrlText(u"file:///C:/Users/测试/a%2Fb") ==
                  UrlValidationResult::valid,
              "url-file-path-unicode-and-percent-preserved");
  tests.Check(ValidateUrlText(u"myapp+clip.v2://例子.invalid/保存") ==
                  UrlValidationResult::valid,
              "url-custom-scheme-iri-preserved");
  tests.Check(ValidateUrlText(u"data:text/plain;charset=utf-8,Hello%2Cworld") ==
                  UrlValidationResult::valid,
              "url-data-opaque-path-retained-without-decoding");
  tests.Check(ValidateUrlText(u"mailto:?subject=clip#原始片段") ==
                  UrlValidationResult::valid,
              "url-mailto-empty-path-query-fragment-preserved");
  tests.Check(ValidateUrlText(u"https://例子.invalid/emoji-😀?q=测试#段落") ==
                  UrlValidationResult::valid,
              "url-iri-supplementary-unicode-scalar-preserved");
  tests.Check(ValidateUrlText(u"custom:path?private=\ue000") ==
                  UrlValidationResult::valid,
              "url-iri-private-use-scalar-allowed-in-query");
  tests.Check(ValidateUrlText(u"custom:path\ue000") ==
                  UrlValidationResult::invalid,
              "url-iri-private-use-scalar-rejected-in-path");
  tests.Check(ValidateUrlText(u"custom:path\U0001fffe") ==
                  UrlValidationResult::invalid,
              "url-iri-plane-ending-noncharacter-rejected");
  tests.Check(ValidateUrlText(u"custom:path\ufdd0") ==
                  UrlValidationResult::invalid,
              "url-iri-noncharacter-range-rejected");
  tests.Check(ValidateUrlText(u"custom:path?empty=#") ==
                  UrlValidationResult::valid,
              "url-empty-query-and-fragment-preserved");
  tests.Check(ValidateUrlText(u"custom:path?x=%F0%9F%8C%99#case%2f") ==
                  UrlValidationResult::valid,
              "url-valid-percent-escape-case-preserved");
  tests.Check(ValidateUrlText(u"custom://") == UrlValidationResult::valid,
              "url-generic-empty-authority-preserved");
  tests.Check(ValidateUrlText(u"scheme:") == UrlValidationResult::valid,
              "url-generic-empty-path-preserved");
  std::u16string long_for_ansi = u"scheme:";
  long_for_ansi.append(40000 - long_for_ansi.size(), u'a');
  tests.Check(IsValidStoredAbsoluteUri(long_for_ansi) &&
                  ValidateUrlText(long_for_ansi) == UrlValidationResult::valid,
              "url-syntax-helper-and-ansi-40k-ascii-candidate-valid");
  tests.Check(ValidateUrlText(u"https:/example.invalid/") ==
                  UrlValidationResult::valid,
              "url-scheme-specific-path-shape-preserved");
  tests.Check(ValidateUrlText(u"https://[v1.alpha:beta]/") ==
                  UrlValidationResult::valid,
              "url-ipvfuture-literal-preserved");
  tests.Check(ValidateUrlText(u"https://[fe80::1%25en0]/") ==
                  UrlValidationResult::valid,
              "url-ipv6-zone-extension-preserved");
  tests.Check(ValidateUrlText(u"https://[fe80::1%25eth%2d0]/") ==
                  UrlValidationResult::valid,
              "url-ipv6-zone-percent-encoding-preserved");
  tests.Check(ValidateUrlText(u"https://[2001:db8::1]:443/path") ==
                  UrlValidationResult::valid,
              "url-ipv6-literal-and-port-preserved");

  tests.Check(ValidateUrlText(u"javascript:alert%281%29") ==
                  UrlValidationResult::valid,
              "url-dangerous-scheme-syntax-retained-without-execution");
  tests.Check(ValidateUrlText(u"1invalid:path") == UrlValidationResult::invalid,
              "url-scheme-must-start-with-ascii-letter");
  tests.Check(ValidateUrlText(u"bad_scheme:path") == UrlValidationResult::invalid,
              "url-invalid-scheme-character-rejected");
  tests.Check(ValidateUrlText(u"relative/path") == UrlValidationResult::invalid,
              "url-relative-reference-rejected");
  tests.Check(ValidateUrlText(u"https://example.invalid/%E9%Q1") ==
                  UrlValidationResult::invalid,
              "url-incomplete-percent-escape-rejected");
  tests.Check(ValidateUrlText(u"https://[:::]/") == UrlValidationResult::invalid,
              "url-invalid-ipv6-literal-rejected");
  tests.Check(ValidateUrlText(u"https://2001:db8::1/") ==
                  UrlValidationResult::invalid,
              "url-unbracketed-ipv6-authority-rejected");
  tests.Check(ValidateUrlText(u"https://[2001:db8::1%eth0]/") ==
                  UrlValidationResult::invalid,
              "url-invalid-ipv6-zone-marker-rejected");
  tests.Check(ValidateUrlText(u"https://example.invalid:abc/") ==
                  UrlValidationResult::invalid,
              "url-nondigit-port-rejected");
  tests.Check(ValidateUrlText(u"https://[::1]tail/") ==
                  UrlValidationResult::invalid,
              "url-invalid-bracketed-host-suffix-rejected");
  tests.Check(ValidateUrlText(u"https://user<name@example.invalid/") ==
                  UrlValidationResult::invalid,
              "url-invalid-userinfo-character-rejected");
  tests.Check(ValidateUrlText(u"custom:path#fragment#extra") ==
                  UrlValidationResult::invalid,
              "url-second-fragment-delimiter-rejected");
  tests.Check(ValidateUrlText(u"custom:path?bad[]") ==
                  UrlValidationResult::invalid,
              "url-invalid-query-bracket-rejected");
  tests.Check(ValidateUrlText(u"custom:path with-space") ==
                  UrlValidationResult::invalid,
              "url-ascii-space-rejected");
  tests.Check(ValidateUrlText(u"custom:path?private=\ufeff") ==
                  UrlValidationResult::valid,
              "url-iri-rfc3987-feff-ucschar-preserved");
  std::u16string unpaired_surrogate = u"custom:path";
  unpaired_surrogate.push_back(static_cast<char16_t>(0xd800));
  tests.Check(ValidateUrlText(unpaired_surrogate) == UrlValidationResult::invalid,
              "url-iri-unpaired-surrogate-rejected");

  return tests.failed;
}
