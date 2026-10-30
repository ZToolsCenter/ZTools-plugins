#pragma once

#include <string>

namespace clipboard_format_probe {

class ClipboardFileReferenceFixture final {
 public:
  ClipboardFileReferenceFixture() = default;
  ClipboardFileReferenceFixture(const ClipboardFileReferenceFixture&) = delete;
  ClipboardFileReferenceFixture& operator=(
      const ClipboardFileReferenceFixture&) = delete;
  ~ClipboardFileReferenceFixture();

  bool Create(bool ascii_names = false);
  bool DeleteFile();
  bool MoveFile();
  bool CreateDirectoryJunction();

  const std::wstring& Root() const { return root_; }
  const std::wstring& File() const { return file_; }
  const std::wstring& Directory() const { return directory_; }
  const std::wstring& MovedSource() const { return moved_source_; }
  const std::wstring& MovedTarget() const { return moved_target_; }
  const std::wstring& DirectoryJunction() const { return directory_junction_; }

 private:
  void Cleanup();

  std::wstring root_;
  std::wstring file_;
  std::wstring directory_;
  std::wstring moved_source_;
  std::wstring moved_target_;
  std::wstring directory_junction_;
  bool owns_root_ = false;
};

}  // namespace clipboard_format_probe
