#include "clipboard_wic_decode.h"

#include <objbase.h>
#include <wrl/client.h>

#include <cstddef>
#include <cstdint>
#include <limits>
#include <new>
#include <stdexcept>
#include <vector>

namespace clipboard_format_probe {
namespace {

using Microsoft::WRL::ComPtr;
constexpr std::uint64_t kMaximumDecodeCpuMilliseconds = 2000;
constexpr std::uint64_t kMaximumDecodeWallMilliseconds = 5000;

class ComApartment final {
 public:
  ComApartment() : result_(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED)) {
    usable_ = SUCCEEDED(result_) || result_ == RPC_E_CHANGED_MODE;
    uninitialize_ = result_ == S_OK || result_ == S_FALSE;
  }
  ~ComApartment() {
    if (uninitialize_) CoUninitialize();
  }
  bool usable() const { return usable_; }

 private:
  HRESULT result_ = E_FAIL;
  bool usable_ = false;
  bool uninitialize_ = false;
};

struct DecodeBudget {
  ULONGLONG wall_start = 0;
  std::uint64_t cpu_start_100ns = 0;
};

bool ProcessCpuTime100ns(std::uint64_t* value) {
  FILETIME creation{};
  FILETIME exit{};
  FILETIME kernel{};
  FILETIME user{};
  if (!GetProcessTimes(GetCurrentProcess(), &creation, &exit, &kernel, &user)) {
    return false;
  }
  ULARGE_INTEGER kernel_value{};
  ULARGE_INTEGER user_value{};
  kernel_value.LowPart = kernel.dwLowDateTime;
  kernel_value.HighPart = kernel.dwHighDateTime;
  user_value.LowPart = user.dwLowDateTime;
  user_value.HighPart = user.dwHighDateTime;
  if (user_value.QuadPart >
      std::numeric_limits<std::uint64_t>::max() - kernel_value.QuadPart) {
    return false;
  }
  *value = kernel_value.QuadPart + user_value.QuadPart;
  return true;
}

void SetError(std::string* error, const char* reason) noexcept {
  if (error == nullptr) return;
  try {
    *error = reason;
  } catch (...) {
    error->clear();
  }
}

bool BeginBudget(DecodeBudget* budget, std::string* error) {
  budget->wall_start = GetTickCount64();
  if (!ProcessCpuTime100ns(&budget->cpu_start_100ns)) {
    SetError(error, "WIC decode budget measurement failed");
    return false;
  }
  return true;
}

bool CheckBudget(const DecodeBudget& budget, std::string* error) {
  std::uint64_t cpu_now = 0;
  if (!ProcessCpuTime100ns(&cpu_now)) {
    SetError(error, "WIC decode budget measurement failed");
    return false;
  }
  const std::uint64_t cpu_elapsed_ms =
      cpu_now < budget.cpu_start_100ns
          ? std::numeric_limits<std::uint64_t>::max()
          : (cpu_now - budget.cpu_start_100ns) / 10000;
  const ULONGLONG wall_elapsed_ms = GetTickCount64() - budget.wall_start;
  if (cpu_elapsed_ms > kMaximumDecodeCpuMilliseconds ||
      wall_elapsed_ms > kMaximumDecodeWallMilliseconds) {
    SetError(error, "WIC decode exceeded its observed budget");
    return false;
  }
  return true;
}

bool Fail(std::string* error, const char* reason) noexcept {
  SetError(error, reason);
  return false;
}

bool ExpectedBytesMatch(const WicFrameExpectation& frame) {
  if (frame.width == 0 || frame.height == 0 ||
      static_cast<std::uint64_t>(frame.width) >
          std::numeric_limits<std::uint64_t>::max() / 4 / frame.height) {
    return false;
  }
  return static_cast<std::uint64_t>(frame.width) * frame.height * 4 ==
         frame.decoded_bytes;
}

}  // namespace

bool ValidateWicContainerFrames(
    const std::vector<std::uint8_t>& bytes, REFGUID expected_container,
    const std::vector<WicFrameExpectation>& expected_frames,
    std::uint64_t maximum_total_decoded_bytes, std::string* error) {
  if (error != nullptr) error->clear();
  if (bytes.empty() || bytes.size() > std::numeric_limits<DWORD>::max() ||
      expected_frames.empty() ||
      expected_frames.size() > std::numeric_limits<UINT>::max()) {
    return Fail(error, "WIC input or expected frame count is out of range");
  }

  std::uint64_t total_decoded_bytes = 0;
  for (const WicFrameExpectation& frame : expected_frames) {
    if (!ExpectedBytesMatch(frame) ||
        frame.decoded_bytes > maximum_total_decoded_bytes ||
        total_decoded_bytes >
            maximum_total_decoded_bytes - frame.decoded_bytes) {
      return Fail(error, "WIC decoded pixel allocation exceeds its limit");
    }
    total_decoded_bytes += frame.decoded_bytes;
  }

  ComApartment apartment;
  if (!apartment.usable()) {
    return Fail(error, "WIC COM initialization failed");
  }

  std::vector<BYTE> stream_bytes;
  try {
    stream_bytes.assign(bytes.begin(), bytes.end());
  } catch (const std::bad_alloc&) {
    return Fail(error, "WIC stream allocation failed");
  } catch (const std::length_error&) {
    return Fail(error, "WIC stream allocation exceeds its limit");
  }

  DecodeBudget budget;
  if (!BeginBudget(&budget, error)) return false;

  ComPtr<IWICImagingFactory> factory;
  if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr,
                              CLSCTX_INPROC_SERVER,
                              IID_PPV_ARGS(factory.GetAddressOf())))) {
    return Fail(error, "WIC factory creation failed");
  }

  ComPtr<IWICStream> stream;
  if (FAILED(factory->CreateStream(stream.GetAddressOf())) ||
      FAILED(stream->InitializeFromMemory(
          stream_bytes.data(), static_cast<DWORD>(stream_bytes.size()))) ||
      !CheckBudget(budget, error)) {
    if (error != nullptr && error->empty()) {
      SetError(error, "WIC stream initialization failed");
    }
    return false;
  }

  ComPtr<IWICBitmapDecoder> decoder;
  if (FAILED(factory->CreateDecoderFromStream(
          stream.Get(), nullptr, WICDecodeMetadataCacheOnDemand,
          decoder.GetAddressOf()))) {
    return Fail(error, "WIC decoder creation failed");
  }
  if (!CheckBudget(budget, error)) return false;

  GUID container_format{};
  UINT frame_count = 0;
  if (FAILED(decoder->GetContainerFormat(&container_format)) ||
      !IsEqualGUID(container_format, expected_container) ||
      FAILED(decoder->GetFrameCount(&frame_count)) ||
      frame_count != static_cast<UINT>(expected_frames.size())) {
    return Fail(error, "WIC container or frame count does not match structure");
  }
  if (!CheckBudget(budget, error)) return false;

  for (UINT index = 0; index < frame_count; ++index) {
    const WicFrameExpectation& expected = expected_frames[index];
    ComPtr<IWICBitmapFrameDecode> frame;
    if (FAILED(decoder->GetFrame(index, frame.GetAddressOf()))) {
      return Fail(error, "WIC frame could not be opened");
    }
    UINT width = 0;
    UINT height = 0;
    if (FAILED(frame->GetSize(&width, &height)) || width != expected.width ||
        height != expected.height || !CheckBudget(budget, error)) {
      if (error != nullptr && error->empty()) {
        SetError(error, "WIC frame dimensions do not match structure");
      }
      return false;
    }

    ComPtr<IWICFormatConverter> converter;
    if (FAILED(factory->CreateFormatConverter(converter.GetAddressOf())) ||
        FAILED(converter->Initialize(frame.Get(), GUID_WICPixelFormat32bppRGBA,
                                     WICBitmapDitherTypeNone, nullptr, 0.0,
                                     WICBitmapPaletteTypeCustom))) {
      return Fail(error, "WIC RGBA pixel conversion failed");
    }
    UINT converted_width = 0;
    UINT converted_height = 0;
    if (FAILED(converter->GetSize(&converted_width, &converted_height)) ||
        converted_width != expected.width ||
        converted_height != expected.height) {
      return Fail(error, "WIC converted dimensions do not match structure");
    }

    const std::uint64_t stride64 =
        static_cast<std::uint64_t>(expected.width) * 4;
    if (stride64 > std::numeric_limits<UINT>::max() ||
        expected.decoded_bytes > std::numeric_limits<UINT>::max()) {
      return Fail(error, "WIC frame allocation exceeds API limits");
    }
    std::vector<BYTE> decoded_pixels;
    try {
      decoded_pixels.resize(static_cast<std::size_t>(expected.decoded_bytes));
    } catch (const std::bad_alloc&) {
      return Fail(error, "WIC frame allocation failed");
    } catch (const std::length_error&) {
      return Fail(error, "WIC frame allocation exceeds its limit");
    }
    if (FAILED(converter->CopyPixels(
            nullptr, static_cast<UINT>(stride64),
            static_cast<UINT>(decoded_pixels.size()), decoded_pixels.data()))) {
      return Fail(error, "WIC pixel decode failed");
    }
    if (!CheckBudget(budget, error)) return false;
  }
  return CheckBudget(budget, error);
}

}  // namespace clipboard_format_probe
