#pragma once

#include <cstddef>
#include <string>
#include <vector>

namespace clipboard_format_probe {

class ClipboardReparseFixture final {
 public:
  ClipboardReparseFixture() = default;
  ClipboardReparseFixture(const ClipboardReparseFixture&) = delete;
  ClipboardReparseFixture& operator=(const ClipboardReparseFixture&) = delete;
  ~ClipboardReparseFixture();

  bool CreateChain(std::size_t junction_count);
  bool CreateCycle();
  const std::wstring& ReferencePath() const { return reference_path_; }

 private:
  bool CreateRoot();
  bool CreateDirectory(const std::wstring& path);
  bool CreateJunction(const std::wstring& link,
                      const std::wstring& target);
  void Cleanup();

  std::wstring root_;
  std::wstring reference_path_;
  std::vector<std::wstring> directories_;
  std::vector<std::wstring> junctions_;
  bool owns_root_ = false;
};

}  // namespace clipboard_format_probe
