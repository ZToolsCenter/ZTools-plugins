#pragma once

#include <string>
#include <string_view>
#include <vector>
#include <windows.h>

namespace clipboard_format_probe {

bool IsSafeFilesystemPath(std::wstring_view path);
bool NormalizeFilesystemPath(std::wstring_view path, std::wstring* output);
bool SplitFilesystemPath(std::wstring_view path, std::wstring* root,
                         std::vector<std::wstring>* components);
bool FilesystemReferenceAccessible(std::wstring_view path,
                                   bool require_read_access,
                                   bool* is_directory);

}  // namespace clipboard_format_probe
