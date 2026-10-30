#include "clipboard_native_api.h"

#include <limits>

namespace clipboard_format_probe {
namespace {

constexpr std::size_t CallIndex(ClipboardApiCall call) noexcept {
    return static_cast<std::size_t>(call);
}

void SaturatingIncrement(std::size_t& value) noexcept {
    if (value < std::numeric_limits<std::size_t>::max()) {
        ++value;
    }
}

}  // namespace

ClipboardNativeApi::ClipboardNativeApi(ClipboardApiFaultPlan* faults) noexcept
    : faults_(faults) {}

BOOL ClipboardNativeApi::Open(HWND owner) const noexcept {
    if (ShouldFail(ClipboardApiCall::open)) {
        SetLastError(ERROR_ACCESS_DENIED);
        return FALSE;
    }

    RecordNative(ClipboardApiCall::open);
    return ::OpenClipboard(owner);
}

BOOL ClipboardNativeApi::Empty() const noexcept {
    if (ShouldFail(ClipboardApiCall::empty)) {
        SetLastError(ERROR_ACCESS_DENIED);
        return FALSE;
    }

    RecordNative(ClipboardApiCall::empty);
    return ::EmptyClipboard();
}

HANDLE ClipboardNativeApi::Set(UINT format, HANDLE data) const noexcept {
    if (ShouldFail(ClipboardApiCall::set)) {
        SetLastError(ERROR_ACCESS_DENIED);
        return nullptr;
    }

    RecordNative(ClipboardApiCall::set);
    return ::SetClipboardData(format, data);
}

BOOL ClipboardNativeApi::Close() const noexcept {
    if (ShouldFail(ClipboardApiCall::close)) {
        SetLastError(ERROR_ACCESS_DENIED);
        return FALSE;
    }

    RecordNative(ClipboardApiCall::close);
    return ::CloseClipboard();
}

bool ClipboardNativeApi::ShouldFail(ClipboardApiCall call) const noexcept {
    if (faults_ == nullptr) {
        return false;
    }

    const std::size_t index = CallIndex(call);
    std::size_t& attempts = faults_->attempts[index];
    SaturatingIncrement(attempts);

    ClipboardApiFaultRule& rule = faults_->rules[index];
    if (rule.first_failure_call == 0 || rule.failures_remaining == 0 ||
        attempts < rule.first_failure_call) {
        return false;
    }

    --rule.failures_remaining;
    return true;
}

void ClipboardNativeApi::RecordNative(ClipboardApiCall call) const noexcept {
    if (faults_ == nullptr) {
        return;
    }

    SaturatingIncrement(faults_->native_calls[CallIndex(call)]);
}

}  // namespace clipboard_format_probe
