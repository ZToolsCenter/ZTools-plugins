#include "clipboard_format_receipts.h"

#include "clipboard_formats.h"

#include <bcrypt.h>

#include <array>
#include <limits>

namespace clipboard_format_probe {

bool HashWindowsReceiptBytes(const std::uint8_t* bytes, std::size_t size,
                             std::string* sha256) {
  if (sha256 == nullptr) return false;
  sha256->clear();
  if (size > kMaximumClipboardBytes ||
      size > std::numeric_limits<ULONG>::max() ||
      (bytes == nullptr && size != 0)) {
    return false;
  }

  std::array<std::uint8_t, 32> digest{};
  std::uint8_t empty_input = 0;
  const std::uint8_t* input = bytes == nullptr ? &empty_input : bytes;
  auto* mutable_input =
      const_cast<PUCHAR>(reinterpret_cast<const UCHAR*>(input));
  const NTSTATUS status = BCryptHash(
      BCRYPT_SHA256_ALG_HANDLE, nullptr, 0, mutable_input,
      static_cast<ULONG>(size), digest.data(),
      static_cast<ULONG>(digest.size()));
  if (status < 0) return false;

  try {
    constexpr char kHex[] = "0123456789abcdef";
    std::string result;
    result.resize(digest.size() * 2);
    for (std::size_t i = 0; i < digest.size(); ++i) {
      result[i * 2] = kHex[digest[i] >> 4];
      result[i * 2 + 1] = kHex[digest[i] & 0x0F];
    }
    sha256->swap(result);
    return true;
  } catch (...) {
    sha256->clear();
    return false;
  }
}

}  // namespace clipboard_format_probe
