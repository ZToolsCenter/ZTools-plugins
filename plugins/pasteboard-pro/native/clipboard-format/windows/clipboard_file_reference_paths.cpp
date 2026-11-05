#include "clipboard_file_reference_paths.h"

#include <algorithm>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>
#include <windows.h>

namespace clipboard_format_probe {
namespace {

constexpr std::wstring_view kExtendedPrefix = L"\\\\?\\";
constexpr std::wstring_view kExtendedUncPrefix = L"\\\\?\\UNC\\";
constexpr std::wstring_view kVolumePrefix = L"\\\\?\\Volume{";
constexpr std::size_t kMaximumPathCharacters = 32767;

bool IsSeparator(wchar_t value) {
  return value == L'\\' || value == L'/';
}

bool IsAsciiAlpha(wchar_t value) {
  return (value >= L'a' && value <= L'z') ||
         (value >= L'A' && value <= L'Z');
}

bool IsHex(wchar_t value) {
  return (value >= L'0' && value <= L'9') ||
         (value >= L'a' && value <= L'f') ||
         (value >= L'A' && value <= L'F');
}

bool StartsWithIgnoreCase(std::wstring_view value,
                          std::wstring_view prefix) {
  return value.size() >= prefix.size() &&
         CompareStringOrdinal(value.data(), static_cast<int>(prefix.size()),
                              prefix.data(), static_cast<int>(prefix.size()),
                              TRUE) == CSTR_EQUAL;
}

bool HasWellFormedUtf16(std::wstring_view value) {
  if (value.empty() || value.size() > kMaximumPathCharacters) return false;
  for (std::size_t index = 0; index < value.size(); ++index) {
    const wchar_t unit = value[index];
    if (unit == L'\0' || unit < 0x20 || unit == L'"' || unit == L'<' ||
        unit == L'>' || unit == L'|' || unit == L'*' ||
        (unit == L'?' &&
         !(index == 2 && value.substr(0, kExtendedPrefix.size()) ==
                             kExtendedPrefix))) {
      return false;
    }
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= value.size()) return false;
      const wchar_t low = value[++index];
      if (low < 0xdc00 || low > 0xdfff) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

bool IsValidUncPath(std::wstring_view path, std::size_t server_start) {
  const std::size_t server_end = path.find_first_of(L"\\/", server_start);
  if (server_end == std::wstring_view::npos || server_end == server_start) {
    return false;
  }
  const auto server = path.substr(server_start, server_end - server_start);
  if (server == L"." || server == L"?" || server == L"..") return false;
  const std::size_t share_start = server_end + 1;
  const std::size_t share_end = path.find_first_of(L"\\/", share_start);
  const std::size_t end = share_end == std::wstring_view::npos
                              ? path.size()
                              : share_end;
  return end > share_start;
}

bool IsDrivePath(std::wstring_view path, std::size_t offset) {
  return path.size() >= offset + 3 && IsAsciiAlpha(path[offset]) &&
         path[offset + 1] == L':' && IsSeparator(path[offset + 2]);
}

bool IsValidVolumePath(std::wstring_view path) {
  if (!StartsWithIgnoreCase(path, kVolumePrefix)) return false;
  const std::size_t close = path.find(L'}', kVolumePrefix.size());
  if (close == std::wstring_view::npos) return false;
  const auto guid = path.substr(kVolumePrefix.size(), close - kVolumePrefix.size());
  if (guid.size() != 36 || guid[8] != L'-' || guid[13] != L'-' ||
      guid[18] != L'-' || guid[23] != L'-') {
    return false;
  }
  for (std::size_t index = 0; index < guid.size(); ++index) {
    if (index == 8 || index == 13 || index == 18 || index == 23) continue;
    if (!IsHex(guid[index])) return false;
  }
  return close + 1 < path.size() && IsSeparator(path[close + 1]);
}

bool HasSafeNamespace(std::wstring_view path) {
  if (path.size() >= kExtendedPrefix.size() &&
      path.substr(0, kExtendedPrefix.size()) == kExtendedPrefix) {
    if (StartsWithIgnoreCase(path, kExtendedUncPrefix)) {
      return IsValidUncPath(path, kExtendedUncPrefix.size());
    }
    return IsDrivePath(path, kExtendedPrefix.size()) ||
           IsValidVolumePath(path);
  }
  if (path.size() >= 2 && IsSeparator(path[0]) && IsSeparator(path[1])) {
    if (path.size() >= 3 && (path[2] == L'.' || path[2] == L'?')) {
      return false;
    }
    return IsValidUncPath(path, 2);
  }
  return IsDrivePath(path, 0);
}

std::optional<std::size_t> RootLength(std::wstring_view path) {
  if (StartsWithIgnoreCase(path, kExtendedUncPrefix)) {
    const std::size_t server_start = kExtendedUncPrefix.size();
    const std::size_t server_end = path.find(L'\\', server_start);
    if (server_end == std::wstring_view::npos) return std::nullopt;
    const std::size_t share_end = path.find(L'\\', server_end + 1);
    return share_end == std::wstring_view::npos ? path.size() : share_end;
  }
  if (path.size() >= 2 && IsSeparator(path[0]) && IsSeparator(path[1])) {
    const std::size_t server_end = path.find(L'\\', 2);
    if (server_end == std::wstring_view::npos) return std::nullopt;
    const std::size_t share_end = path.find(L'\\', server_end + 1);
    return share_end == std::wstring_view::npos ? path.size() : share_end;
  }
  if (path.size() >= kExtendedPrefix.size() &&
      path.substr(0, kExtendedPrefix.size()) == kExtendedPrefix) {
    if (IsDrivePath(path, kExtendedPrefix.size())) {
      return kExtendedPrefix.size() + 3;
    }
    if (StartsWithIgnoreCase(path, kVolumePrefix)) {
      const std::size_t close = path.find(L'}', kVolumePrefix.size());
      if (close != std::wstring_view::npos && close + 1 < path.size() &&
          IsSeparator(path[close + 1])) {
        return close + 2;
      }
    }
    return std::nullopt;
  }
  if (IsDrivePath(path, 0)) return 3;
  return std::nullopt;
}

bool IsNumberedDeviceName(std::wstring_view stem) {
  if (stem.size() != 4) return false;
  const wchar_t suffix = stem[3];
  if (!((suffix >= L'1' && suffix <= L'9') || suffix == L'\u00b9' ||
        suffix == L'\u00b2' || suffix == L'\u00b3')) {
    return false;
  }
  return CompareStringOrdinal(stem.data(), 3, L"COM", 3, TRUE) == CSTR_EQUAL ||
         CompareStringOrdinal(stem.data(), 3, L"LPT", 3, TRUE) == CSTR_EQUAL;
}

bool IsDeviceName(std::wstring_view component) {
  const std::size_t extension = component.find(L'.');
  const auto stem = component.substr(0, extension);
  constexpr std::wstring_view simple[] = {
      L"CON", L"PRN", L"AUX", L"NUL", L"CONIN$", L"CONOUT$"};
  for (const auto device : simple) {
    if (CompareStringOrdinal(stem.data(), static_cast<int>(stem.size()),
                             device.data(), static_cast<int>(device.size()),
                             TRUE) == CSTR_EQUAL) {
      return true;
    }
  }
  return IsNumberedDeviceName(stem);
}

std::wstring NormalizeSeparators(std::wstring_view path) {
  std::wstring result(path);
  std::replace(result.begin(), result.end(), L'/', L'\\');
  return result;
}

bool HasSafeRootAndColonSyntax(std::wstring_view path) {
  if (!HasWellFormedUtf16(path) || !HasSafeNamespace(path) ||
      !RootLength(path).has_value()) {
    return false;
  }
  for (std::size_t index = 0; index < path.size(); ++index) {
    if (path[index] != L':') continue;
    if ((index == 1 && IsAsciiAlpha(path[0])) ||
        (index == kExtendedPrefix.size() + 1 &&
         path.substr(0, kExtendedPrefix.size()) == kExtendedPrefix &&
         IsAsciiAlpha(path[kExtendedPrefix.size()]))) {
      continue;
    }
    return false;
  }
  return true;
}

bool IsSafeComponents(std::wstring_view path, bool permit_dot_segments) {
  const auto root_length = RootLength(path);
  if (!root_length.has_value()) return false;
  std::size_t cursor = *root_length;
  while (cursor < path.size()) {
    while (cursor < path.size() && IsSeparator(path[cursor])) ++cursor;
    if (cursor == path.size()) break;
    const std::size_t end = path.find_first_of(L"\\/", cursor);
    const auto component = path.substr(
        cursor, end == std::wstring_view::npos ? std::wstring_view::npos
                                               : end - cursor);
    const bool dot_segment = component == L"." || component == L"..";
    if ((!permit_dot_segments && dot_segment) || component.empty() ||
        (!dot_segment && (component.back() == L'.' ||
                          component.back() == L' ' ||
                          IsDeviceName(component)))) {
      return false;
    }
    if (end == std::wstring_view::npos) break;
    cursor = end + 1;
  }
  return true;
}

void AppendComponent(std::wstring* path, std::wstring_view component) {
  if (!path->empty() && !IsSeparator(path->back())) path->push_back(L'\\');
  path->append(component);
}

}  // namespace

bool IsSafeFilesystemPath(std::wstring_view path) {
  if (!HasWellFormedUtf16(path)) return false;
  const std::wstring normalized = NormalizeSeparators(path);
  return HasSafeRootAndColonSyntax(normalized) &&
         IsSafeComponents(normalized, false);
}

bool NormalizeFilesystemPath(std::wstring_view path,
                             std::wstring* output) {
  if (output == nullptr || !HasWellFormedUtf16(path)) return false;
  const std::wstring normalized = NormalizeSeparators(path);
  if (!HasSafeRootAndColonSyntax(normalized) ||
      !IsSafeComponents(normalized, true)) {
    return false;
  }
  const auto root_length = RootLength(normalized);
  if (!root_length.has_value()) return false;

  std::wstring root(normalized.substr(0, *root_length));
  if (root.empty() || !IsSeparator(root.back())) root.push_back(L'\\');
  std::vector<std::wstring> components;
  std::size_t cursor = *root_length;
  while (cursor < normalized.size()) {
    while (cursor < normalized.size() && IsSeparator(normalized[cursor])) ++cursor;
    if (cursor == normalized.size()) break;
    const std::size_t end = normalized.find(L'\\', cursor);
    const auto component = normalized.substr(
        cursor, end == std::wstring::npos ? std::wstring::npos
                                          : end - cursor);
    if (component == L"..") {
      if (components.empty()) return false;
      components.pop_back();
    } else if (component != L".") {
      components.emplace_back(component);
    }
    cursor = end == std::wstring::npos ? normalized.size() : end + 1;
  }

  *output = std::move(root);
  for (const auto& component : components) AppendComponent(output, component);
  return output->size() <= kMaximumPathCharacters &&
         IsSafeFilesystemPath(*output);
}

bool SplitFilesystemPath(std::wstring_view path, std::wstring* root,
                         std::vector<std::wstring>* components) {
  if (root == nullptr || components == nullptr ||
      !IsSafeFilesystemPath(path)) {
    return false;
  }
  const std::wstring normalized = NormalizeSeparators(path);
  const auto root_length = RootLength(normalized);
  if (!root_length.has_value()) return false;
  root->assign(normalized.substr(0, *root_length));
  if (root->empty() || !IsSeparator(root->back())) root->push_back(L'\\');
  components->clear();
  std::size_t cursor = *root_length;
  while (cursor < normalized.size()) {
    while (cursor < normalized.size() && IsSeparator(normalized[cursor])) ++cursor;
    if (cursor == normalized.size()) break;
    const std::size_t end = normalized.find(L'\\', cursor);
    const std::size_t length = end == std::wstring::npos
                                   ? normalized.size() - cursor
                                   : end - cursor;
    components->emplace_back(normalized.substr(cursor, length));
    cursor = end == std::wstring::npos ? normalized.size() : end + 1;
  }
  return true;
}

}  // namespace clipboard_format_probe
