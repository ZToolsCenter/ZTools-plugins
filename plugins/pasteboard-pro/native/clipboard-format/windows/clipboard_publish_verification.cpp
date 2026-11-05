#include "clipboard_publish_verification.h"

#include "clipboard_format_equivalence.h"

#include <utility>

namespace clipboard_format_probe {
namespace {

bool MaterializeReadback(const PreparedFormat& planned, HANDLE handle,
                         FormatPayload* readback, std::string* error) {
  if (handle == nullptr || readback == nullptr || error == nullptr) {
    return false;
  }
  // GetClipboardData returns a handle, not a second format descriptor. The
  // exact requested ID selects the readback; key/name remain bound to the
  // frozen, already-validated PreparedFormat plan.
  readback->key = planned.payload.key;
  readback->native_name = planned.payload.native_name;
  readback->format_id = planned.payload.format_id;
  readback->encoding = planned.payload.encoding;
  readback->fidelity = planned.payload.fidelity;
  readback->source_format = planned.payload.source_format;
  readback->source_origin = planned.payload.source_origin;
  readback->materialization = planned.payload.materialization;

  switch (planned.storage) {
    case PreparedFormat::Storage::global_memory:
      return CopyGlobalMemory(handle, readback, error);
    case PreparedFormat::Storage::gdi_bitmap:
      return CopyBitmapToDib(reinterpret_cast<HBITMAP>(handle), readback,
                             error);
    case PreparedFormat::Storage::gdi_palette:
      return CopyPaletteToLogPalette(reinterpret_cast<HPALETTE>(handle),
                                     readback, error);
    case PreparedFormat::Storage::none:
      return false;
  }
  return false;
}

}  // namespace

PublishVerificationResult VerifyPublishedFormats(
    const std::vector<std::unique_ptr<PreparedFormat>>& plan,
    const PublishReadbackReader& reader,
    const PublishReadbackTransform& transform) {
  PublishVerificationResult result;
  if (plan.empty()) return result;

  try {
    for (const auto& item : plan) {
      if (item == nullptr) return PublishVerificationResult{};
      const UINT format_id = item->payload.format_id;
      HANDLE handle = reader ? reader(format_id) : GetClipboardData(format_id);
      FormatPayload readback;
      std::string error;
      if (!MaterializeReadback(*item, handle, &readback, &error)) {
        return PublishVerificationResult{};
      }
      if (transform) transform(format_id, &readback);

      const auto comparison = CompareFormatRepresentations(
          item->payload, readback,
          FormatComparisonMode::allow_visible_bitmap_rgb);
      switch (comparison) {
        case FormatComparison::exact:
        case FormatComparison::compatible:
          result.verified_keys.push_back(item->payload.key);
          break;
        case FormatComparison::mismatch:
          result.mismatched_keys.push_back(item->payload.key);
          break;
        case FormatComparison::unconfirmed:
          return PublishVerificationResult{};
      }
    }
  } catch (...) {
    return PublishVerificationResult{};
  }

  result.state = result.mismatched_keys.empty()
                     ? PublishVerificationState::verified
                     : PublishVerificationState::mismatch;
  return result;
}

}  // namespace clipboard_format_probe
