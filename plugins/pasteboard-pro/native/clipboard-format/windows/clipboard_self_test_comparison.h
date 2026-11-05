#pragma once

#include "clipboard_probe.h"

#include <cstddef>
#include <string>
#include <vector>

namespace clipboard_format_probe::self_test_comparison {

bool IsCompleteCapture(const OperationResult& result,
                       const ClipboardSnapshot& snapshot,
                       std::string* error = nullptr);

bool HasPublishedRepresentations(
    const std::vector<FormatPayload>& published,
    const ClipboardSnapshot& snapshot, bool allow_bitmap_pixel_equivalence,
    std::string* error = nullptr);

bool HasExactRepresentations(
    const std::vector<FormatPayload>& expected,
    const ClipboardSnapshot& snapshot, bool allow_bitmap_pixel_equivalence,
    std::string* error = nullptr);

bool CompleteCaptureMatchesPublished(
    const std::vector<FormatPayload>& published,
    const OperationResult& result, const ClipboardSnapshot& snapshot,
    bool allow_bitmap_pixel_equivalence, std::string* error = nullptr);

bool CompleteCaptureMatchesExactly(
    const std::vector<FormatPayload>& expected,
    const OperationResult& result, const ClipboardSnapshot& snapshot,
    bool allow_bitmap_pixel_equivalence, std::string* error = nullptr);

std::vector<std::string> PayloadKeys(
    const std::vector<FormatPayload>& formats, std::size_t begin = 0);

std::vector<FormatPayload> PayloadPrefix(
    const std::vector<FormatPayload>& formats, std::size_t count);

bool PublishWroteExactly(const OperationResult& result,
                         const std::vector<FormatPayload>& expected);

bool RestoreAndVerifySnapshot(
    Win32ClipboardAdapter* adapter,
    const std::vector<FormatPayload>& expected);

bool ShiftHtmlStartFragment(FormatPayload* format, int delta);

bool SameKeys(const std::vector<std::string>& left,
              const std::vector<std::string>& right);

}  // namespace clipboard_format_probe::self_test_comparison
