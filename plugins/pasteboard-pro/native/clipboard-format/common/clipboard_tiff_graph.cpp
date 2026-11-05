#include "clipboard_tiff_internal.h"

#include <utility>

namespace clipboard_codecs::tiff_internal {
namespace {

bool VisitEdge(Context* context, std::uint32_t target, std::size_t depth) {
  if (target == 0) return true;
  if (++context->total_edges > kMaximumTiffIfdEdges) {
    return context->Fail("TIFF IFD graph has too many references");
  }
  return VisitIfdGraph(context, target, depth);
}

bool VisitPointerField(Context* context, const Directory& directory,
                       const Field& field, std::size_t depth) {
  const bool is_sub_ifds = field.tag == 330;
  if (!is_sub_ifds && field.count != 1) {
    return context->Fail("TIFF metadata IFD pointer must be scalar");
  }
  if (is_sub_ifds && field.count > kMaximumTiffIfdEdges) {
    return context->Fail("TIFF SubIFDs array is too large");
  }
  if ((is_sub_ifds && field.type != 4 && field.type != 13) ||
      (!is_sub_ifds && field.type != 4)) {
    return context->Fail("TIFF metadata IFD pointer has an invalid type");
  }
  for (std::uint32_t index = 0; index < field.count; ++index) {
    std::uint64_t value = 0;
    if (!ReadUnsignedValue(*context, field, index, &value)) {
      return context->Fail("TIFF metadata IFD pointer is unreadable");
    }
    if (value > UINT32_MAX ||
        !VisitEdge(context, static_cast<std::uint32_t>(value), depth)) {
      if (context->error.empty()) {
        context->Fail("TIFF metadata IFD pointer is out of range");
      }
      return false;
    }
  }
  (void)directory;
  return true;
}

}  // namespace

bool VisitIfdGraph(Context* context, std::uint32_t offset,
                   std::size_t depth) {
  if (context == nullptr || offset == 0) return offset == 0;
  if (depth > kMaximumTiffIfdDepth) {
    return context->Fail("TIFF IFD graph exceeds maximum depth");
  }
  const auto color = context->colors.find(offset);
  if (color != context->colors.end()) {
    if (color->second == 1) {
      return context->Fail("TIFF IFD graph contains a cycle");
    }
    return true;
  }
  if (context->directories.size() >= kMaximumTiffIfdNodes) {
    return context->Fail("TIFF IFD graph contains too many nodes");
  }

  Directory directory;
  if (!ParseDirectory(context, offset, &directory)) return false;
  const auto inserted =
      context->directories.emplace(offset, std::move(directory));
  const Directory& stored = inserted.first->second;
  context->colors[offset] = 1;

  for (const auto& field : stored.fields) {
    if (field.tag == 330 || field.tag == 34665 || field.tag == 34853 ||
        field.tag == 40965) {
      if (!VisitPointerField(context, directory, field, depth + 1)) {
        return false;
      }
    }
  }
  if (!VisitEdge(context, stored.next_offset, depth + 1)) return false;
  context->colors[offset] = 2;
  return true;
}

}  // namespace clipboard_codecs::tiff_internal
