#include <dlfcn.h>
#include <signal.h>
#include <unistd.h>

#include <cstdint>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

namespace wevision2 {
class ByteBuffer;
class PixelBuffer;
enum Orientation : int;

struct DnnInferenceOptions {
  uint8_t prefix[0x20] = {};
  std::string cache_or_device;
};
}  // namespace wevision2

static_assert(offsetof(wevision2::DnnInferenceOptions, cache_or_device) == 0x20,
              "unexpected DnnInferenceOptions layout");

static std::string dirname(std::string path) {
  size_t pos = path.find_last_of('/');
  return pos == std::string::npos ? "." : path.substr(0, pos);
}

template <class T>
static T sym(void* lib, const char* name, bool required = true) {
  dlerror();
  void* fn = dlsym(lib, name);
  if (!fn && required) {
    std::fprintf(stderr, "missing symbol %s: %s\n", name, dlerror());
    std::exit(2);
  }
  return reinterpret_cast<T>(fn);
}

static void on_alarm(int) {
  std::fprintf(stderr, "probe timed out\n");
  std::_Exit(124);
}

static wevision2::DnnInferenceOptions make_wechat_options() {
  wevision2::DnnInferenceOptions options;
  std::memset(options.prefix, 0xaa, sizeof(options.prefix));
  options.prefix[0] = 0;
  *reinterpret_cast<uint64_t*>(options.prefix + 0x08) = 1;
  *reinterpret_cast<uint64_t*>(options.prefix + 0x10) = 0x300000003ULL;
  *reinterpret_cast<uint32_t*>(options.prefix + 0x18) = 0;
  return options;
}

int main(int argc, char** argv) {
  if (argc < 3) {
    std::fprintf(stderr, "Usage: %s <libwxocr.dylib> <image>\n", argv[0]);
    return 2;
  }

  signal(SIGALRM, on_alarm);
  alarm(30);

  std::string lib_path = argv[1];
  std::string frameworks = dirname(lib_path);
  std::string resources = dirname(frameworks) + "/Resources";

  std::string old_dyld = std::getenv("DYLD_LIBRARY_PATH") ? std::getenv("DYLD_LIBRARY_PATH") : "";
  std::string dyld = frameworks + (old_dyld.empty() ? "" : ":" + old_dyld);
  setenv("DYLD_LIBRARY_PATH", dyld.c_str(), 1);

  void* mojo = dlopen((frameworks + "/libmmmojo.dylib").c_str(), RTLD_NOW | RTLD_GLOBAL);
  if (!mojo) {
    std::fprintf(stderr, "dlopen libmmmojo failed: %s\n", dlerror());
  }

  void* lib = dlopen(lib_path.c_str(), RTLD_NOW | RTLD_GLOBAL);
  if (!lib) {
    std::fprintf(stderr, "dlopen libwxocr failed: %s\n", dlerror());
    return 1;
  }

  using MakeFromFileFn = std::shared_ptr<wevision2::ByteBuffer> (*)(const std::string&);
  using ImageDecodeFn = std::shared_ptr<wevision2::PixelBuffer> (*)(std::shared_ptr<wevision2::ByteBuffer>);
  using TextRecognizerCtorFn = void (*)(void*, const std::string&, const std::string&, const std::string&,
                                        const wevision2::DnnInferenceOptions&);
  using TextRecognizerSetupFn = int (*)(void*);
  using TextRecognizerRecognizeStringsFn = int (*)(void*, std::shared_ptr<wevision2::PixelBuffer>,
                                                   std::vector<std::string>&, wevision2::Orientation*);
  using TextRecognizerRecognizeStringFn =
      int (*)(void*, std::shared_ptr<wevision2::PixelBuffer>, std::string&, wevision2::Orientation*);

  auto make_from_file = sym<MakeFromFileFn>(
      lib,
      "_ZN9wevision210ByteBuffer12MakeFromFileERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE");
  auto image_decode =
      sym<ImageDecodeFn>(lib, "_ZN9wevision211ImageDecodeENSt3__110shared_ptrINS_10ByteBufferEEE");
  auto text_ctor = sym<TextRecognizerCtorFn>(
      lib,
      "_ZN9wevision214TextRecognizerC1ERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEES9_S9_RKNS_19DnnInferenceOptionsE");
  auto text_setup = sym<TextRecognizerSetupFn>(lib, "_ZN9wevision214TextRecognizer16SetupRecognitionEv");
  auto recognize_strings = sym<TextRecognizerRecognizeStringsFn>(
      lib,
      "_ZN9wevision214TextRecognizer9RecognizeENSt3__110shared_ptrINS_11PixelBufferEEERNS1_6vectorINS1_12basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEENS9_ISB_EEEEPNS_11OrientationE");
  auto recognize_string = sym<TextRecognizerRecognizeStringFn>(
      lib,
      "_ZN9wevision214TextRecognizer9RecognizeENSt3__110shared_ptrINS_11PixelBufferEEERNS1_12basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPNS_11OrientationE",
      false);

  std::string image_path = argv[2];
  auto bytes = make_from_file(image_path);
  std::fprintf(stderr, "bytebuffer=%p\n", bytes.get());
  if (!bytes) return 1;

  auto pixel = image_decode(bytes);
  std::fprintf(stderr, "pixelbuffer=%p\n", pixel.get());
  if (!pixel) return 1;

  const std::string det_model = resources + "/text_det_fp16_v1.xnet";
  const std::string rec_model = resources + "/text_rec_fp16_v2.xnet";
  std::vector<std::string> third_args = {
      "",
      resources + "/charset_zh10798.txt",
      resources,
      resources + "/FPMMFG1V1.2.0.26.xnet",
      resources + "/FPMMFG2V1.3.1.26.xnet",
  };

  for (const std::string& third : third_args) {
    std::fprintf(stderr, "trying TextRecognizer third='%s'\n", third.c_str());
    alignas(16) uint8_t recognizer_storage[4096] = {};
    wevision2::DnnInferenceOptions options = make_wechat_options();
    text_ctor(recognizer_storage, det_model, rec_model, third, options);

    int setup_rc = text_setup(recognizer_storage);
    std::fprintf(stderr, "setup rc=%d\n", setup_rc);

    std::vector<std::string> lines;
    wevision2::Orientation* orientation = nullptr;
    int rc = recognize_strings(recognizer_storage, pixel, lines, orientation);
    std::printf("third=%s vector_rc=%d lines=%zu\n", third.c_str(), rc, lines.size());
    for (size_t i = 0; i < lines.size(); ++i) {
      std::printf("line[%zu]=%s\n", i, lines[i].c_str());
    }
    std::fflush(stdout);
    if (!lines.empty()) return 0;

    if (recognize_string) {
      std::string text;
      rc = recognize_string(recognizer_storage, pixel, text, orientation);
      std::printf("third=%s string_rc=%d text=%s\n", third.c_str(), rc, text.c_str());
      std::fflush(stdout);
      if (!text.empty()) return 0;
    }
  }

  return 1;
}
