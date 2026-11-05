#pragma once

#include <windows.h>
#include "clipboard_native_api.h"

namespace clipboard_format_probe {

// Owns a successful OpenClipboard call until the explicit close boundary.
// Construct it only after OpenClipboard returns TRUE.
class ClipboardResourceSession final {
 public:
  explicit ClipboardResourceSession(const ClipboardNativeApi* api = nullptr)
      : api_(api) {}
  ClipboardResourceSession(const ClipboardResourceSession&) = delete;
  ClipboardResourceSession& operator=(const ClipboardResourceSession&) = delete;

  ~ClipboardResourceSession() {
    if (held_) CloseNative();
  }

  bool Close() {
    if (!held_) return true;
    if (!CloseNative()) return false;
    held_ = false;
    return true;
  }

 private:
  bool CloseNative() noexcept {
    return api_ != nullptr ? api_->Close() != FALSE : ::CloseClipboard() != FALSE;
  }
  const ClipboardNativeApi* api_;
  bool held_ = true;
};

}  // namespace clipboard_format_probe
