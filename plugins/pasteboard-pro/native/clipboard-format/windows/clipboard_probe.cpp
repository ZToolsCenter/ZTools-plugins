#include "clipboard_probe.h"
#include "clipboard_formats.h"
#include "clipboard_file_references.h"
#include "clipboard_publish_verification.h"
#include "clipboard_resource_session.h"

#include <algorithm>
#include <limits>
#include <memory>
#include <utility>

namespace clipboard_format_probe {

Win32ClipboardAdapter::~Win32ClipboardAdapter() {
  Shutdown();
}

bool Win32ClipboardAdapter::Initialize(std::string* error) {
  if (window_ != nullptr) {
    if (error != nullptr) *error = "clipboard adapter is already initialized";
    return false;
  }
  html_id_ = RegisterClipboardFormatW(L"HTML Format");
  rtf_id_ = RegisterClipboardFormatW(L"Rich Text Format");
  png_id_ = RegisterClipboardFormatW(L"PNG");
  image_png_id_ = RegisterClipboardFormatW(L"image/png");
  monitor_exclusion_id_ = RegisterClipboardFormatW(
      L"ExcludeClipboardContentFromMonitorProcessing");
  local_history_marker_id_ =
      RegisterClipboardFormatW(L"CanIncludeInClipboardHistory");
  cloud_upload_marker_id_ =
      RegisterClipboardFormatW(L"CanUploadToCloudClipboard");
  if (html_id_ == 0 || rtf_id_ == 0 || png_id_ == 0 ||
      image_png_id_ == 0 || monitor_exclusion_id_ == 0 ||
      local_history_marker_id_ == 0 || cloud_upload_marker_id_ == 0) {
    if (error != nullptr) *error = "could not register clipboard formats";
    return false;
  }

  WNDCLASSEXW window_class{};
  window_class.cbSize = sizeof(window_class);
  window_class.lpfnWndProc = WindowProcedure;
  window_class.hInstance = GetModuleHandleW(nullptr);
  window_class.lpszClassName = L"PasteboardFormatProbeWindow";
  window_class.style = CS_NOCLOSE;
  window_class.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  window_class.hbrBackground = reinterpret_cast<HBRUSH>(GetStockObject(WHITE_BRUSH));
  window_class_ = RegisterClassExW(&window_class);
  if (window_class_ == 0) {
    if (error != nullptr) *error = "could not register probe window class";
    return false;
  }

  window_ = CreateWindowExW(
      WS_EX_TOOLWINDOW, window_class.lpszClassName, L"Clipboard format probe",
      WS_POPUP, 0, 0, 1, 1, nullptr, nullptr, window_class.hInstance, this);
  if (window_ == nullptr) {
    UnregisterClassW(window_class.lpszClassName, window_class.hInstance);
    window_class_ = 0;
    if (error != nullptr) *error = "could not create probe listener window";
    return false;
  }
  ShowWindow(window_, SW_HIDE);
  if (!AddClipboardFormatListener(window_)) {
    if (error != nullptr) *error = "AddClipboardFormatListener failed";
    Shutdown();
    return false;
  }
  return true;
}

void Win32ClipboardAdapter::Shutdown() {
  if (window_ != nullptr) {
    RemoveClipboardFormatListener(window_);
    DestroyWindow(window_);
    window_ = nullptr;
  }
  if (window_class_ != 0) {
    UnregisterClassW(L"PasteboardFormatProbeWindow", GetModuleHandleW(nullptr));
    window_class_ = 0;
  }
}

LRESULT CALLBACK Win32ClipboardAdapter::WindowProcedure(
    HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
  auto* self = reinterpret_cast<Win32ClipboardAdapter*>(
      GetWindowLongPtrW(window, GWLP_USERDATA));
  if (message == WM_NCCREATE) {
    const auto* create =
        reinterpret_cast<const CREATESTRUCTW*>(lparam);
    self = static_cast<Win32ClipboardAdapter*>(create->lpCreateParams);
    SetWindowLongPtrW(window, GWLP_USERDATA,
                      reinterpret_cast<LONG_PTR>(self));
  }
  if (self != nullptr) {
    return self->HandleMessage(window, message, wparam, lparam);
  }
  return DefWindowProcW(window, message, wparam, lparam);
}

LRESULT Win32ClipboardAdapter::HandleMessage(
    HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
  if (message == WM_CLIPBOARDUPDATE) {
    if (update_count_ != std::numeric_limits<UINT>::max()) ++update_count_;
    return 0;
  }
  if (message == WM_NCDESTROY) {
    SetWindowLongPtrW(window, GWLP_USERDATA, 0);
  }
  return DefWindowProcW(window, message, wparam, lparam);
}

std::uint32_t Win32ClipboardAdapter::Revision() const {
  return GetClipboardSequenceNumber();
}



}  // namespace clipboard_format_probe
