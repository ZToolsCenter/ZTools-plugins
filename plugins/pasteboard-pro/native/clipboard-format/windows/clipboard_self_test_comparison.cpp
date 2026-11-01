#include "clipboard_self_test_comparison.h"

#include <algorithm>
#include <initializer_list>
#include <set>
#include <string>
#include <windows.h>

#include "clipboard_formats.h"
#include "clipboard_format_equivalence.h"

namespace clipboard_format_probe::self_test_comparison {
namespace {

void SetError(std::string* error, const char* message) {
  if (error != nullptr) *error = message;
}

bool SameRepresentation(const FormatPayload& expected,
                        const FormatPayload& actual,
                        bool allow_bitmap_pixel_equivalence) {
  const auto mode = allow_bitmap_pixel_equivalence
                        ? FormatComparisonMode::allow_visible_bitmap_rgb
                        : FormatComparisonMode::exact;
  const auto comparison = CompareFormatRepresentations(expected, actual, mode);
  return comparison == FormatComparison::exact ||
         comparison == FormatComparison::compatible;
}

bool UniqueCapturedFormats(const std::vector<FormatPayload>& formats,
                           std::string* error) {
  std::set<std::string> keys;
  std::set<UINT> ids;
  for (const auto& format : formats) {
    if (!keys.insert(format.key).second || !ids.insert(format.format_id).second) {
      SetError(error, "capture contains a duplicate key or format id");
      return false;
    }
    std::string validation_error;
    if (!IsPayloadWellFormed(format, &validation_error)) {
      SetError(error, "capture contains an invalid typed representation");
      return false;
    }
  }
  return true;
}

std::set<UINT> PublishedSynthesisClosure(
    const std::vector<FormatPayload>& published) {
  std::set<UINT> ids;
  for (const auto& format : published) ids.insert(format.format_id);

  bool changed = true;
  while (changed) {
    const std::size_t before = ids.size();
    const auto add = [&ids](UINT source, std::initializer_list<UINT> targets) {
      if (ids.count(source) != 0) ids.insert(targets.begin(), targets.end());
    };
    add(CF_BITMAP, {CF_DIB, CF_DIBV5});
    add(CF_DIB, {CF_BITMAP, CF_DIBV5, CF_PALETTE});
    add(CF_DIBV5, {CF_BITMAP, CF_DIB, CF_PALETTE});
    add(CF_TEXT, {CF_OEMTEXT, CF_UNICODETEXT});
    add(CF_OEMTEXT, {CF_TEXT, CF_UNICODETEXT});
    add(CF_UNICODETEXT, {CF_TEXT, CF_OEMTEXT});
    changed = ids.size() != before;
  }

  const bool has_locale_seed =
      std::any_of(published.begin(), published.end(), [](const auto& format) {
        return format.format_id == CF_LOCALE;
      });
  if (ids.count(CF_TEXT) != 0 && !has_locale_seed) ids.insert(CF_LOCALE);
  return ids;
}

}  // namespace

bool SameKeys(const std::vector<std::string>& left,
              const std::vector<std::string>& right) {
  if (left.size() != right.size()) return false;
  const std::set<std::string> left_set(left.begin(), left.end());
  const std::set<std::string> right_set(right.begin(), right.end());
  return left_set.size() == left.size() &&
         right_set.size() == right.size() && left_set == right_set;
}

bool IsCompleteCapture(const OperationResult& result,
                       const ClipboardSnapshot& snapshot,
                       std::string* error) {
  if (result.status != OperationStatus::committed ||
      !result.missing_keys.empty() || !snapshot.missing_keys.empty()) {
    SetError(error, "capture was not committed without missing formats");
    return false;
  }
  std::vector<std::string> captured_keys;
  captured_keys.reserve(snapshot.formats.size());
  for (const auto& format : snapshot.formats) captured_keys.push_back(format.key);
  if (!SameKeys(result.planned_keys, captured_keys)) {
    SetError(error, "capture did not materialize every planned supported format");
    return false;
  }
  return UniqueCapturedFormats(snapshot.formats, error);
}

bool HasPublishedRepresentations(
    const std::vector<FormatPayload>& published,
    const ClipboardSnapshot& snapshot, bool allow_bitmap_pixel_equivalence,
    std::string* error) {
  if (published.empty() || !snapshot.missing_keys.empty() ||
      !UniqueCapturedFormats(published, error) ||
      !UniqueCapturedFormats(snapshot.formats, error)) {
    if (error != nullptr && error->empty()) {
      *error = "published set or captured snapshot is incomplete";
    }
    return false;
  }

  const std::set<UINT> allowed_ids = PublishedSynthesisClosure(published);
  for (const auto& wanted : published) {
    std::string validation_error;
    if (!IsPayloadWellFormed(wanted, &validation_error)) {
      SetError(error, "published seed is not a valid typed representation");
      return false;
    }
    const auto found = std::find_if(
        snapshot.formats.begin(), snapshot.formats.end(),
        [&wanted](const FormatPayload& item) { return item.key == wanted.key; });
    if (found == snapshot.formats.end() ||
        !SameRepresentation(wanted, *found,
                            allow_bitmap_pixel_equivalence)) {
      SetError(error, "a published seed representation was lost or changed");
      return false;
    }
  }

  for (const auto& actual : snapshot.formats) {
    if (allowed_ids.count(actual.format_id) == 0) {
      SetError(error, "capture contains a format outside the documented synthesis closure");
      return false;
    }
  }
  return true;
}

bool HasExactRepresentations(
    const std::vector<FormatPayload>& expected,
    const ClipboardSnapshot& snapshot, bool allow_bitmap_pixel_equivalence,
    std::string* error) {
  if (expected.empty() || expected.size() != snapshot.formats.size() ||
      !UniqueCapturedFormats(expected, error) ||
      !UniqueCapturedFormats(snapshot.formats, error)) {
    if (error != nullptr && error->empty()) {
      *error = "captured format set differs from the frozen snapshot";
    }
    return false;
  }
  for (const auto& wanted : expected) {
    const auto found = std::find_if(
        snapshot.formats.begin(), snapshot.formats.end(),
        [&wanted](const FormatPayload& item) { return item.key == wanted.key; });
    if (found == snapshot.formats.end() ||
        !SameRepresentation(wanted, *found,
                            allow_bitmap_pixel_equivalence)) {
      SetError(error, "frozen format identity, bytes, or materialization changed");
      return false;
    }
  }
  return true;
}

bool CompleteCaptureMatchesPublished(
    const std::vector<FormatPayload>& published,
    const OperationResult& result, const ClipboardSnapshot& snapshot,
    bool allow_bitmap_pixel_equivalence, std::string* error) {
  return IsCompleteCapture(result, snapshot, error) &&
         HasPublishedRepresentations(published, snapshot,
                                     allow_bitmap_pixel_equivalence, error);
}

bool CompleteCaptureMatchesExactly(
    const std::vector<FormatPayload>& expected,
    const OperationResult& result, const ClipboardSnapshot& snapshot,
    bool allow_bitmap_pixel_equivalence, std::string* error) {
  return IsCompleteCapture(result, snapshot, error) &&
         HasExactRepresentations(expected, snapshot,
                                 allow_bitmap_pixel_equivalence, error);
}

std::vector<std::string> PayloadKeys(
    const std::vector<FormatPayload>& formats, std::size_t begin) {
  begin = std::min(begin, formats.size());
  std::vector<std::string> keys;
  keys.reserve(formats.size() - begin);
  for (auto item = formats.begin() + begin; item != formats.end(); ++item) {
    keys.push_back(item->key);
  }
  return keys;
}

std::vector<FormatPayload> PayloadPrefix(
    const std::vector<FormatPayload>& formats, std::size_t count) {
  count = std::min(count, formats.size());
  return {formats.begin(), formats.begin() + count};
}

bool PublishWroteExactly(const OperationResult& result,
                         const std::vector<FormatPayload>& expected) {
  const auto keys = PayloadKeys(expected);
  return result.status == OperationStatus::committed &&
         result.planned_keys == keys && result.written_keys == keys &&
         result.missing_keys.empty() && result.write_revision.has_value() &&
         result.observed_revision == *result.write_revision;
}

bool RestoreAndVerifySnapshot(
    Win32ClipboardAdapter* adapter,
    const std::vector<FormatPayload>& expected) {
  if (adapter == nullptr || expected.empty()) return false;
  const OperationResult published =
      adapter->Publish(adapter->Revision(), expected);
  if (!PublishWroteExactly(published, expected)) return false;
  ClipboardSnapshot snapshot;
  const OperationResult captured =
      adapter->Capture(published.observed_revision, &snapshot);
  return CompleteCaptureMatchesExactly(expected, captured, snapshot, false);
}

bool ShiftHtmlStartFragment(FormatPayload* format, int delta) {
  if (format == nullptr) return false;
  const std::string payload(format->bytes.begin(), format->bytes.end());
  const std::string field = "StartFragment:";
  const std::size_t field_offset = payload.find(field);
  if (field_offset == std::string::npos) return false;
  const std::size_t value_offset = field_offset + field.size();
  const unsigned long long value =
      std::stoull(payload.substr(value_offset, 10));
  if (delta < 0 && value < static_cast<unsigned long long>(-delta)) return false;
  const unsigned long long shifted =
      delta < 0 ? value - static_cast<unsigned long long>(-delta)
                : value + static_cast<unsigned long long>(delta);
  const std::string digits = std::to_string(shifted);
  if (digits.size() > 10) return false;
  std::fill_n(format->bytes.begin() + value_offset, 10,
              static_cast<std::uint8_t>('0'));
  std::copy(digits.begin(), digits.end(),
            format->bytes.begin() + value_offset + 10 - digits.size());
  return true;
}

}  // namespace clipboard_format_probe::self_test_comparison
