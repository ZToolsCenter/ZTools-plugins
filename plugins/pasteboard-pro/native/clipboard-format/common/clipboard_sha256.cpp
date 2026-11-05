#include "clipboard_sha256.h"

#include <algorithm>
#include <array>

namespace clipboard_format_probe {
namespace {

constexpr std::array<std::uint32_t, 64> kRoundConstants = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};

std::uint32_t RotateRight(std::uint32_t value, unsigned int count) {
  return (value >> count) | (value << (32 - count));
}

class Sha256 {
 public:
  Sha256()
      : state_{{0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19}} {}

  void Update(const std::uint8_t* bytes, std::size_t length) {
    total_bytes_ += static_cast<std::uint64_t>(length);
    while (length != 0) {
      const std::size_t copied =
          std::min(length, block_.size() - block_size_);
      std::copy_n(bytes, copied, block_.begin() + block_size_);
      bytes += copied;
      length -= copied;
      block_size_ += copied;
      if (block_size_ == block_.size()) {
        Transform(block_.data());
        block_size_ = 0;
      }
    }
  }

  std::array<std::uint8_t, 32> Finalize() {
    const std::uint64_t bit_length = total_bytes_ * 8;
    block_[block_size_++] = 0x80;
    if (block_size_ > 56) {
      std::fill(block_.begin() + block_size_, block_.end(), 0);
      Transform(block_.data());
      block_size_ = 0;
    }
    std::fill(block_.begin() + block_size_, block_.begin() + 56, 0);
    for (std::size_t index = 0; index < 8; ++index) {
      block_[63 - index] = static_cast<std::uint8_t>(bit_length >> (index * 8));
    }
    Transform(block_.data());

    std::array<std::uint8_t, 32> digest{};
    for (std::size_t word = 0; word < state_.size(); ++word) {
      for (std::size_t byte = 0; byte < 4; ++byte) {
        digest[word * 4 + byte] = static_cast<std::uint8_t>(
            state_[word] >> ((3 - byte) * 8));
      }
    }
    return digest;
  }

 private:
  void Transform(const std::uint8_t* block) {
    std::array<std::uint32_t, 64> words{};
    for (std::size_t index = 0; index < 16; ++index) {
      const std::size_t offset = index * 4;
      words[index] = (static_cast<std::uint32_t>(block[offset]) << 24) |
                     (static_cast<std::uint32_t>(block[offset + 1]) << 16) |
                     (static_cast<std::uint32_t>(block[offset + 2]) << 8) |
                     static_cast<std::uint32_t>(block[offset + 3]);
    }
    for (std::size_t index = 16; index < words.size(); ++index) {
      const std::uint32_t sigma0 = RotateRight(words[index - 15], 7) ^
                                   RotateRight(words[index - 15], 18) ^
                                   (words[index - 15] >> 3);
      const std::uint32_t sigma1 = RotateRight(words[index - 2], 17) ^
                                   RotateRight(words[index - 2], 19) ^
                                   (words[index - 2] >> 10);
      words[index] = words[index - 16] + sigma0 + words[index - 7] + sigma1;
    }

    std::uint32_t a = state_[0];
    std::uint32_t b = state_[1];
    std::uint32_t c = state_[2];
    std::uint32_t d = state_[3];
    std::uint32_t e = state_[4];
    std::uint32_t f = state_[5];
    std::uint32_t g = state_[6];
    std::uint32_t h = state_[7];
    for (std::size_t index = 0; index < words.size(); ++index) {
      const std::uint32_t sum1 = RotateRight(e, 6) ^ RotateRight(e, 11) ^
                                 RotateRight(e, 25);
      const std::uint32_t choice = (e & f) ^ (~e & g);
      const std::uint32_t temp1 =
          h + sum1 + choice + kRoundConstants[index] + words[index];
      const std::uint32_t sum0 = RotateRight(a, 2) ^ RotateRight(a, 13) ^
                                 RotateRight(a, 22);
      const std::uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
      const std::uint32_t temp2 = sum0 + majority;
      h = g;
      g = f;
      f = e;
      e = d + temp1;
      d = c;
      c = b;
      b = a;
      a = temp1 + temp2;
    }
    state_[0] += a;
    state_[1] += b;
    state_[2] += c;
    state_[3] += d;
    state_[4] += e;
    state_[5] += f;
    state_[6] += g;
    state_[7] += h;
  }

  std::array<std::uint32_t, 8> state_;
  std::array<std::uint8_t, 64> block_{};
  std::size_t block_size_ = 0;
  std::uint64_t total_bytes_ = 0;
};

}  // namespace

std::string PortableSha256Hex(const std::uint8_t* bytes, std::size_t length) {
  if (bytes == nullptr && length != 0) return {};
  Sha256 hash;
  if (length != 0) hash.Update(bytes, length);
  const auto digest = hash.Finalize();
  constexpr char kHex[] = "0123456789abcdef";
  std::string output;
  output.reserve(64);
  for (const std::uint8_t byte : digest) {
    output.push_back(kHex[byte >> 4]);
    output.push_back(kHex[byte & 0x0f]);
  }
  return output;
}

}  // namespace clipboard_format_probe
