#include "clipboard_formats.h"

namespace clipboard_format_probe {

PreparedFormat::~PreparedFormat() {
  const HANDLE handle = ClipboardHandle();
  bool attempted = false;
  bool succeeded = false;
  if (!transferred) {
    if (storage == Storage::global_memory && global_memory != nullptr) {
      attempted = true;
      succeeded = GlobalFree(global_memory) == nullptr;
    } else if (storage == Storage::gdi_bitmap && bitmap != nullptr) {
      attempted = true;
      succeeded = DeleteObject(bitmap) != FALSE;
    } else if (storage == Storage::gdi_palette && palette != nullptr) {
      attempted = true;
      succeeded = DeleteObject(palette) != FALSE;
    }
  }
  if (release_observer_for_testing != nullptr) {
    release_observer_for_testing(storage, handle, transferred, attempted,
        succeeded, release_observer_context_for_testing);
  }
}

HANDLE PreparedFormat::ClipboardHandle() const {
  if (storage == Storage::gdi_bitmap) {
    return reinterpret_cast<HANDLE>(bitmap);
  }
  if (storage == Storage::gdi_palette) {
    return reinterpret_cast<HANDLE>(palette);
  }
  if (storage == Storage::global_memory) {
    return reinterpret_cast<HANDLE>(global_memory);
  }
  return nullptr;
}

void PreparedFormat::MarkTransferred() {
  transferred = true;
}

}  // namespace clipboard_format_probe
