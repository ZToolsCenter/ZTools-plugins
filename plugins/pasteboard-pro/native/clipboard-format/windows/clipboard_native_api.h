#pragma once

#include <array>
#include <cstddef>

#include <windows.h>

namespace clipboard_format_probe {

enum class ClipboardApiCall : std::size_t {
    open,
    empty,
    set,
    close,
    count,
};

struct ClipboardApiFaultRule {
    std::size_t first_failure_call = 0;
    std::size_t failures_remaining = 0;
};

struct ClipboardApiFaultPlan {
    std::array<ClipboardApiFaultRule, 4> rules{};
    std::array<std::size_t, 4> attempts{};
    std::array<std::size_t, 4> native_calls{};
};

// Narrow native-call boundary with an optional, per-adapter fault plan.
// The caller owns the plan and must keep it alive for this object's lifetime.
class ClipboardNativeApi final {
public:
    explicit ClipboardNativeApi(ClipboardApiFaultPlan* faults = nullptr) noexcept;

    BOOL Open(HWND owner) const noexcept;
    BOOL Empty() const noexcept;
    HANDLE Set(UINT format, HANDLE data) const noexcept;
    BOOL Close() const noexcept;

private:
    bool ShouldFail(ClipboardApiCall call) const noexcept;
    void RecordNative(ClipboardApiCall call) const noexcept;

    ClipboardApiFaultPlan* faults_;
};

}  // namespace clipboard_format_probe
