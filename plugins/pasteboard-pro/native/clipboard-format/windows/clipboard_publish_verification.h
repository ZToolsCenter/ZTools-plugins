#pragma once

#include "clipboard_formats.h"

#include <functional>
#include <memory>
#include <vector>

namespace clipboard_format_probe {

enum class PublishVerificationState { verified, mismatch, unconfirmed };

struct PublishVerificationResult {
  PublishVerificationState state = PublishVerificationState::unconfirmed;
  std::vector<std::string> verified_keys;
  std::vector<std::string> mismatched_keys;
};

using PublishReadbackReader = std::function<HANDLE(UINT format_id)>;
using PublishReadbackTransform =
    std::function<void(UINT format_id, FormatPayload* readback)>;

// Reads only the frozen planned formats. The default reader uses GetClipboardData;
// callers must hold the clipboard resource session for the whole operation.
PublishVerificationResult VerifyPublishedFormats(
    const std::vector<std::unique_ptr<PreparedFormat>>& plan,
    const PublishReadbackReader& reader = {},
    const PublishReadbackTransform& transform = {});

}  // namespace clipboard_format_probe
