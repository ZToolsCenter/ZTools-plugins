#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace clipboard_reparse {

constexpr std::uint32_t kSymbolicLinkTag = 0xA000000Cu;
constexpr std::uint32_t kMountPointTag = 0xA0000003u;
constexpr std::size_t kMaximumBufferSize = 16 * 1024;
constexpr std::uint32_t kMaximumReparseHops = 63;

struct Target {
  std::u16string substitute_name;
  std::u16string print_name;
  bool is_relative = false;
};

// Parses the byte layout returned by FSCTL_GET_REPARSE_POINT without WinSDK
// types. Only the expected Microsoft symbolic-link and mount-point tags pass.
// On every failure, output is reset to its default state.
bool ParseBuffer(const std::uint8_t* bytes, std::size_t capacity,
                 std::size_t returned, std::uint32_t expected_tag,
                 Target* output);

// `hops_already_followed` counts completed reparse traversals before the next
// link is inspected. The first 63 links are allowed; link 64 is rejected.
bool CanFollowHop(std::uint32_t hops_already_followed);

}  // namespace clipboard_reparse
