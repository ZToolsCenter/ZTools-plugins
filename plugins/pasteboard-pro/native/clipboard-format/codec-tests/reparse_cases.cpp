#include "reparse_cases.h"

#include "../common/clipboard_reparse.h"

#include <cstdint>
#include <iostream>
#include <string>
#include <vector>

namespace {

struct TestRunner {
  int failed = 0;

  void Check(bool condition, const char* id) {
    std::cout << (condition ? "PASS " : "FAIL ") << id << '\n';
    if (!condition) ++failed;
  }
};

void PutU16(std::vector<std::uint8_t>* bytes, std::size_t offset,
            std::uint16_t value) {
  (*bytes)[offset] = static_cast<std::uint8_t>(value & 0xff);
  (*bytes)[offset + 1] = static_cast<std::uint8_t>(value >> 8);
}

void PutU32(std::vector<std::uint8_t>* bytes, std::size_t offset,
            std::uint32_t value) {
  for (std::size_t index = 0; index < 4; ++index) {
    (*bytes)[offset + index] =
        static_cast<std::uint8_t>((value >> (index * 8)) & 0xff);
  }
}

void AppendUtf16Le(std::vector<std::uint8_t>* bytes,
                   const std::u16string& text) {
  for (const char16_t unit : text) {
    bytes->push_back(static_cast<std::uint8_t>(unit & 0xff));
    bytes->push_back(static_cast<std::uint8_t>(unit >> 8));
  }
}

std::vector<std::uint8_t> MakeWire(std::uint32_t tag,
                                   const std::u16string& substitute,
                                   const std::u16string& print,
                                   std::uint32_t flags = 0,
                                   bool print_first = false) {
  const bool symbolic_link = tag == clipboard_reparse::kSymbolicLinkTag;
  const std::size_t fixed_length = symbolic_link ? 12 : 8;
  std::vector<std::uint8_t> path;
  path.reserve((substitute.size() + print.size()) * 2);
  const std::u16string& first = print_first ? print : substitute;
  const std::u16string& second = print_first ? substitute : print;
  AppendUtf16Le(&path, first);
  AppendUtf16Le(&path, second);

  const std::size_t first_bytes = first.size() * 2;
  const std::size_t substitute_offset = print_first ? first_bytes : 0;
  const std::size_t print_offset = print_first ? 0 : first_bytes;
  const std::size_t data_length = fixed_length + path.size();
  std::vector<std::uint8_t> wire(8 + data_length, 0);
  PutU32(&wire, 0, tag);
  PutU16(&wire, 4, static_cast<std::uint16_t>(data_length));
  PutU16(&wire, 8, static_cast<std::uint16_t>(substitute_offset));
  PutU16(&wire, 10, static_cast<std::uint16_t>(substitute.size() * 2));
  PutU16(&wire, 12, static_cast<std::uint16_t>(print_offset));
  PutU16(&wire, 14, static_cast<std::uint16_t>(print.size() * 2));
  if (symbolic_link) PutU32(&wire, 16, flags);
  for (std::size_t index = 0; index < path.size(); ++index) {
    wire[8 + fixed_length + index] = path[index];
  }
  return wire;
}

bool Parses(const std::vector<std::uint8_t>& wire, std::uint32_t expected_tag,
            const std::u16string& substitute, const std::u16string& print,
            bool relative = false) {
  clipboard_reparse::Target target;
  return clipboard_reparse::ParseBuffer(wire.data(), wire.size(), wire.size(),
                                        expected_tag, &target) &&
         target.substitute_name == substitute && target.print_name == print &&
         target.is_relative == relative;
}

bool FailsAndClears(const std::vector<std::uint8_t>& wire,
                    std::size_t returned, std::uint32_t expected_tag) {
  clipboard_reparse::Target target{u"stale-substitute", u"stale-print", true};
  const bool parsed = clipboard_reparse::ParseBuffer(
      wire.data(), wire.size(), returned, expected_tag, &target);
  return !parsed && target.substitute_name.empty() && target.print_name.empty() &&
         !target.is_relative;
}

}  // namespace

int RunReparseCases() {
  TestRunner tests;
  using namespace clipboard_reparse;

  const auto symbolic = MakeWire(kSymbolicLinkTag, u"\\??\\C:\\target",
                                 u"C:\\target");
  tests.Check(symbolic.size() >= 20 && symbolic[0] == 0x0c &&
                  symbolic[1] == 0x00 && symbolic[2] == 0x00 &&
                  symbolic[3] == 0xa0 &&
                  Parses(symbolic, kSymbolicLinkTag, u"\\??\\C:\\target",
                         u"C:\\target"),
              "reparse-symlink-little-endian-wire");

  const auto mount = MakeWire(kMountPointTag, u"\\??\\C:\\folder",
                              u"C:\\folder");
  tests.Check(mount[0] == 0x03 && mount[1] == 0x00 && mount[2] == 0x00 &&
                  mount[3] == 0xa0 &&
                  Parses(mount, kMountPointTag, u"\\??\\C:\\folder",
                         u"C:\\folder"),
              "reparse-mount-point-little-endian-wire");

  const auto reversed = MakeWire(kSymbolicLinkTag, u"substitute-name",
                                 u"print-name", 0, true);
  tests.Check(Parses(reversed, kSymbolicLinkTag, u"substitute-name",
                     u"print-name"),
              "reparse-nonzero-offset-print-before-substitute");

  const auto no_print = MakeWire(kSymbolicLinkTag, u"target-name", u"");
  tests.Check(Parses(no_print, kSymbolicLinkTag, u"target-name", u""),
              "reparse-empty-print-name-is-valid");

  const auto relative = MakeWire(kSymbolicLinkTag, u"relative\\target",
                                 u"relative\\target", 1);
  tests.Check(Parses(relative, kSymbolicLinkTag, u"relative\\target",
                     u"relative\\target", true),
              "reparse-relative-symbolic-link-flag");

  const std::u16string nul_name = {u'b', u'a', u'd', u'\0',
                                  u'n', u'a', u'm', u'e'};
  const auto embedded_nul = MakeWire(kSymbolicLinkTag, nul_name, u"");
  tests.Check(FailsAndClears(embedded_nul, embedded_nul.size(),
                             kSymbolicLinkTag),
              "reparse-embedded-nul-rejected-and-output-cleared");

  const std::u16string paired_surrogate = u"emoji-\U0001F642-target";
  const auto valid_surrogates = MakeWire(kMountPointTag, paired_surrogate,
                                         paired_surrogate);
  tests.Check(Parses(valid_surrogates, kMountPointTag, paired_surrogate,
                     paired_surrogate),
              "reparse-valid-surrogate-pair-accepted");

  const std::u16string dangling_high = {u'a', 0xd800};
  const auto high_surrogate = MakeWire(kMountPointTag, dangling_high, u"");
  tests.Check(FailsAndClears(high_surrogate, high_surrogate.size(),
                             kMountPointTag),
              "reparse-unpaired-high-surrogate-rejected");
  const std::u16string dangling_low = {u'a', 0xdc00};
  const auto low_surrogate = MakeWire(kMountPointTag, dangling_low, u"");
  tests.Check(FailsAndClears(low_surrogate, low_surrogate.size(),
                             kMountPointTag),
              "reparse-unpaired-low-surrogate-rejected");

  auto valid = MakeWire(kSymbolicLinkTag, u"target", u"print");
  tests.Check(FailsAndClears(valid, 7, kSymbolicLinkTag),
              "reparse-truncated-header-rejected");
  auto truncated_fixed = valid;
  PutU16(&truncated_fixed, 4, 11);
  auto truncated_mount = MakeWire(kMountPointTag, u"target", u"print");
  PutU16(&truncated_mount, 4, 7);
  tests.Check(FailsAndClears(truncated_fixed, truncated_fixed.size(),
                             kSymbolicLinkTag) &&
                  FailsAndClears(truncated_mount, truncated_mount.size(),
                                 kMountPointTag),
              "reparse-truncated-fixed-header-rejected");
  tests.Check(FailsAndClears(valid, valid.size() - 1, kSymbolicLinkTag),
              "reparse-returned-length-bounds-data");
  tests.Check(FailsAndClears(valid, valid.size(), kMountPointTag),
              "reparse-tag-must-match-expected-tag");
  tests.Check(FailsAndClears(valid, valid.size(), 0xA0000005u),
              "reparse-unknown-expected-tag-rejected");

  auto reserved = MakeWire(kSymbolicLinkTag, u"C:/target", u"C:/target");
  auto reserved_mount = MakeWire(kMountPointTag, u"C:/target", u"C:/target");
  PutU16(&reserved, 6, 1);
  PutU16(&reserved_mount, 6, 0xffff);
  tests.Check(Parses(reserved, kSymbolicLinkTag, u"C:/target", u"C:/target") &&
                  Parses(reserved_mount, kMountPointTag, u"C:/target", u"C:/target"),
              "reparse-reserved-value-ignored-for-known-tags");

  const std::u16string separator(1, static_cast<char16_t>(0x5c));
  const auto mount_parent = MakeWire(kMountPointTag, u"C:/folder/../target", u"");
  const auto mount_dot = MakeWire(kMountPointTag,
      u"C:" + separator + u"." + separator + u"target", u"");
  tests.Check(FailsAndClears(mount_parent, mount_parent.size(), kMountPointTag) &&
                  FailsAndClears(mount_dot, mount_dot.size(), kMountPointTag),
              "reparse-mount-substitute-dot-components-rejected");
  const auto print_parent = MakeWire(kMountPointTag, u"C:/target", u"C:/folder/..");
  const auto print_dot = MakeWire(kMountPointTag, u"C:/target", u"./target");
  tests.Check(FailsAndClears(print_parent, print_parent.size(), kMountPointTag) &&
                  FailsAndClears(print_dot, print_dot.size(), kMountPointTag),
              "reparse-mount-print-dot-components-rejected");
  const auto dotted_names = MakeWire(kMountPointTag, u"C:/a..b/.hidden", u"C:/a..b");
  tests.Check(Parses(dotted_names, kMountPointTag, u"C:/a..b/.hidden", u"C:/a..b"),
              "reparse-mount-dotted-component-names-preserved");
  const auto relative_dots = MakeWire(kSymbolicLinkTag, u"../folder/./target", u"./target", 1);
  tests.Check(Parses(relative_dots, kSymbolicLinkTag, u"../folder/./target", u"./target", true),
              "reparse-symbolic-dot-components-preserved");
  auto unknown_flags = valid;
  PutU32(&unknown_flags, 16, 2);
  tests.Check(FailsAndClears(unknown_flags, unknown_flags.size(),
                             kSymbolicLinkTag),
              "reparse-unknown-symbolic-link-flags-rejected");

  auto odd_offset = valid;
  PutU16(&odd_offset, 8, 1);
  tests.Check(FailsAndClears(odd_offset, odd_offset.size(), kSymbolicLinkTag),
              "reparse-odd-substitute-offset-rejected");
  auto odd_length = valid;
  PutU16(&odd_length, 10, 3);
  tests.Check(FailsAndClears(odd_length, odd_length.size(), kSymbolicLinkTag),
              "reparse-odd-substitute-length-rejected");
  auto out_of_range = valid;
  PutU16(&out_of_range, 8, 0xfffe);
  tests.Check(FailsAndClears(out_of_range, out_of_range.size(),
                             kSymbolicLinkTag),
              "reparse-substitute-offset-out-of-range-rejected");
  auto overflow_length = valid;
  PutU16(&overflow_length, 8, 2);
  PutU16(&overflow_length, 10, 0xffff);
  tests.Check(FailsAndClears(overflow_length, overflow_length.size(),
                             kSymbolicLinkTag),
              "reparse-substitute-length-overflow-rejected");
  auto odd_print_offset = valid;
  PutU16(&odd_print_offset, 12, 1);
  tests.Check(FailsAndClears(odd_print_offset, odd_print_offset.size(),
                             kSymbolicLinkTag),
              "reparse-odd-print-offset-rejected");
  auto odd_print_length = valid;
  PutU16(&odd_print_length, 14, 3);
  tests.Check(FailsAndClears(odd_print_length, odd_print_length.size(),
                             kSymbolicLinkTag),
              "reparse-odd-print-length-rejected");
  auto invalid_print = valid;
  PutU16(&invalid_print, 12, 0xfffe);
  PutU16(&invalid_print, 14, 2);
  tests.Check(FailsAndClears(invalid_print, invalid_print.size(),
                             kSymbolicLinkTag),
              "reparse-print-offset-out-of-range-rejected");
  auto empty_substitute = MakeWire(kSymbolicLinkTag, u"", u"print");
  tests.Check(FailsAndClears(empty_substitute, empty_substitute.size(),
                             kSymbolicLinkTag),
              "reparse-empty-substitute-name-rejected");

  const std::u16string maximum_name(kMaximumBufferSize / 2 - 10, u'x');
  const auto maximum = MakeWire(kSymbolicLinkTag, maximum_name, u"");
  tests.Check(maximum.size() == kMaximumBufferSize &&
                  Parses(maximum, kSymbolicLinkTag, maximum_name, u""),
              "reparse-16k-buffer-boundary-accepted");
  auto oversized = maximum;
  oversized.push_back(0);
  tests.Check(FailsAndClears(oversized, oversized.size(), kSymbolicLinkTag),
              "reparse-over-16k-buffer-rejected");
  tests.Check(FailsAndClears(oversized, valid.size(), kSymbolicLinkTag),
              "reparse-capacity-over-16k-rejected");
  tests.Check(FailsAndClears(valid, valid.size() + 1, kSymbolicLinkTag),
              "reparse-returned-length-over-capacity-rejected");

  std::uint32_t allowed_hops = 0;
  while (CanFollowHop(allowed_hops)) ++allowed_hops;
  bool each_allowed = allowed_hops == 63;
  for (std::uint32_t hop = 0; hop < 63; ++hop) {
    each_allowed = each_allowed && CanFollowHop(hop);
  }
  tests.Check(each_allowed && !CanFollowHop(63) && !CanFollowHop(64),
              "reparse-hop-guard-allows-1-through-63-rejects-64");

  return tests.failed;
}
