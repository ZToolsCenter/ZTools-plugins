#pragma once
#include <array>
#include <string_view>

namespace pasteboard_storage {
inline constexpr std::array<std::string_view, 15> kFoundationCases = {
  "private-root-created", "root-owner-dacl-verified", "private-file-created",
  "file-owner-dacl-verified", "file-identity-stable", "file-flush-write-handle",
  "mismatched-identity-rejected", "null-dacl-rejected", "empty-dacl-rejected",
  "additional-principal-rejected", "file-kind-mismatch-rejected",
  "reparse-object-rejected", "hardlink-object-rejected", "directory-flush-call-observed",
  "owned-fixture-cleanup"
};
}  // namespace pasteboard_storage
