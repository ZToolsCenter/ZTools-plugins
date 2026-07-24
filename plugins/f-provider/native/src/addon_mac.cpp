#include <node_api.h>

#include <cstddef>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>

#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace {

#ifdef _WIN32
using NativePath = std::wstring;
using LibHandle = HMODULE;
using WechatOcrFn = bool(__cdecl *)(const wchar_t *, const wchar_t *, const char *, void(__cdecl *)(const char *));
using StopOcrFn = void(__cdecl *)();
#else
using NativePath = std::string;
using LibHandle = void *;
using WechatOcrFn = bool (*)(const char *, const char *, const char *, void (*)(const char *));
using StopOcrFn = void (*)();
#endif

struct LoadedLibrary {
  LibHandle handle = nullptr;
  WechatOcrFn wechat_ocr = nullptr;
  StopOcrFn stop_ocr = nullptr;
  std::string path;
};

LoadedLibrary g_lib;
thread_local std::string g_last_result;

#ifdef __APPLE__
namespace wevision2 {
class ByteBuffer;
class PixelBuffer;
enum Orientation : int;

struct DnnInferenceOptions {
  uint8_t prefix[0x20] = {};
  std::string cache_or_device;
};

template <class T>
struct Point2 {
  T x;
  T y;
};

// Layout of wevision2::OCRText, reverse-engineered from libwxocr.dylib and
// verified against the recognizer output (see static_asserts below). The
// TextRecognizer::Recognize(vector<OCRText>&) overload fills one element per
// detected line; each carries the line text, per-word segments, the 4 box
// corner points (order: left-top, right-top, right-bottom, left-bottom) and a
// confidence score. We only read these fields, but modeling the full struct
// (including the owning std::string/std::vector members) lets the vector
// destruct cleanly with no leaks.
struct OneChar {
  std::string text;                  // 0x00 per-word/segment text
  std::vector<Point2<float>> box;    // 0x18 per-word box corner points
};

struct OCRText {
  std::string text;                  // 0x00 line text
  std::vector<OneChar> chars;        // 0x18 per-word segments (text + box)
  std::vector<Point2<float>> box;    // 0x30 4 corner points (lt, rt, rb, lb)
  float rate;                        // 0x48 recognition confidence
  float reserved;                    // 0x4c padding to 0x50
};
}  // namespace wevision2

static_assert(offsetof(wevision2::DnnInferenceOptions, cache_or_device) == 0x20,
              "unexpected DnnInferenceOptions layout");
static_assert(sizeof(wevision2::OCRText) == 0x50, "unexpected OCRText size");
static_assert(offsetof(wevision2::OCRText, chars) == 0x18, "unexpected OCRText.chars offset");
static_assert(offsetof(wevision2::OCRText, box) == 0x30, "unexpected OCRText.box offset");
static_assert(offsetof(wevision2::OCRText, rate) == 0x48, "unexpected OCRText.rate offset");

struct MacWevisionLibrary {
  void *mmmojo = nullptr;
  void *wxocr = nullptr;
  std::string lib_path;
  std::string resources_dir;
  std::vector<uint8_t> recognizer_storage;
  bool recognizer_ready = false;
  std::mutex mutex;

  using MakeFromFileFn = std::shared_ptr<wevision2::ByteBuffer> (*)(const std::string &);
  using ImageDecodeFn = std::shared_ptr<wevision2::PixelBuffer> (*)(std::shared_ptr<wevision2::ByteBuffer>);
  using TextRecognizerCtorFn = void (*)(void *, const std::string &, const std::string &, const std::string &,
                                        const wevision2::DnnInferenceOptions &);
  using TextRecognizerSetupFn = int (*)(void *);
  using TextRecognizerRecognizeStringsFn = int (*)(void *, std::shared_ptr<wevision2::PixelBuffer>,
                                                   std::vector<std::string> &, wevision2::Orientation *);
  using TextRecognizerRecognizeTextsFn = int (*)(void *, std::shared_ptr<wevision2::PixelBuffer>,
                                                 std::vector<wevision2::OCRText> &, wevision2::Orientation *);

  MakeFromFileFn make_from_file = nullptr;
  ImageDecodeFn image_decode = nullptr;
  TextRecognizerCtorFn text_ctor = nullptr;
  TextRecognizerSetupFn text_setup = nullptr;
  TextRecognizerRecognizeStringsFn recognize_strings = nullptr;
  TextRecognizerRecognizeTextsFn recognize_texts = nullptr;
};

MacWevisionLibrary g_mac_wevision;
#endif

void Throw(napi_env env, const std::string &message) {
  napi_throw_error(env, nullptr, message.c_str());
}

void Check(napi_env env, napi_status status, const char *message) {
  if (status != napi_ok) {
    const napi_extended_error_info *info = nullptr;
    napi_get_last_error_info(env, &info);
    std::string detail = message;
    if (info && info->error_message) {
      detail += ": ";
      detail += info->error_message;
    }
    throw std::runtime_error(detail);
  }
}

std::string GetString(napi_env env, napi_value value, const char *name) {
  size_t len = 0;
  Check(env, napi_get_value_string_utf8(env, value, nullptr, 0, &len), name);
  std::vector<char> buffer(len + 1);
  Check(env, napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(), &len), name);
  std::string out(buffer.data(), len);
  out.resize(len);
  return out;
}

bool GetOptionalStringProp(napi_env env, napi_value object, const char *name, std::string *out) {
  bool has = false;
  Check(env, napi_has_named_property(env, object, name, &has), name);
  if (!has) {
    return false;
  }

  napi_value value;
  Check(env, napi_get_named_property(env, object, name, &value), name);

  napi_valuetype type;
  Check(env, napi_typeof(env, value, &type), name);
  if (type == napi_undefined || type == napi_null) {
    return false;
  }
  if (type != napi_string) {
    throw std::runtime_error(std::string("options.") + name + " must be a string");
  }

  *out = GetString(env, value, name);
  return !out->empty();
}

std::string Dirname(std::string path) {
  size_t pos = path.find_last_of("/\\");
  return pos == std::string::npos ? "." : path.substr(0, pos);
}

std::string GetRequiredStringProp(napi_env env, napi_value object, const char *name) {
  std::string out;
  if (!GetOptionalStringProp(env, object, name, &out)) {
    throw std::runtime_error(std::string("options.") + name + " is required");
  }
  return out;
}

std::vector<std::string> DefaultLibraryCandidates() {
  std::vector<std::string> candidates;

  if (const char *env_path = std::getenv("WCOCR_LIB_PATH"); env_path && *env_path) {
    candidates.emplace_back(env_path);
  }

#ifdef _WIN32
  candidates.emplace_back("wcocr.dll");
  candidates.emplace_back(".\\wcocr.dll");
  candidates.emplace_back("..\\build\\Release\\wcocr.dll");
  candidates.emplace_back("..\\build\\wcocr.dll");
#else
  candidates.emplace_back("../build-mac/libwcocr.dylib");
  candidates.emplace_back("../build/libwcocr.dylib");
#endif

  return candidates;
}

#ifdef _WIN32
std::wstring Utf8ToWide(const std::string &input) {
  if (input.empty()) {
    return std::wstring();
  }
  int len = MultiByteToWideChar(CP_UTF8, 0, input.c_str(), static_cast<int>(input.size()), nullptr, 0);
  if (len <= 0) {
    throw std::runtime_error("failed to convert UTF-8 string to UTF-16");
  }
  std::wstring out(len, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, input.c_str(), static_cast<int>(input.size()), out.data(), len);
  return out;
}

LibHandle OpenLibrary(const std::string &path, std::string *error) {
  std::wstring wide = Utf8ToWide(path);
  HMODULE handle = LoadLibraryW(wide.c_str());
  if (!handle) {
    DWORD code = GetLastError();
    *error = "LoadLibraryW failed with error " + std::to_string(code);
  }
  return handle;
}

void *LoadSymbol(LibHandle handle, const char *name) {
  return reinterpret_cast<void *>(GetProcAddress(handle, name));
}

void CloseLibrary(LibHandle handle) {
  if (handle) {
    FreeLibrary(handle);
  }
}
#else
LibHandle OpenLibrary(const std::string &path, std::string *error) {
  dlerror();
  void *handle = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
  if (!handle) {
    const char *msg = dlerror();
    *error = msg ? msg : "dlopen failed";
  }
  return handle;
}

void *LoadSymbol(LibHandle handle, const char *name) {
  return dlsym(handle, name);
}

void CloseLibrary(LibHandle handle) {
  if (handle) {
    dlclose(handle);
  }
}
#endif

void LoadLibraryIfNeeded(const std::string &requested_path) {
  if (g_lib.handle) {
    if (!requested_path.empty() && requested_path != g_lib.path) {
      throw std::runtime_error("wcocr library is already loaded from " + g_lib.path);
    }
    return;
  }

  std::vector<std::string> candidates;
  if (!requested_path.empty()) {
    candidates.push_back(requested_path);
  } else {
    candidates = DefaultLibraryCandidates();
  }

  std::string errors;
  for (const auto &candidate : candidates) {
    std::string error;
    LibHandle handle = OpenLibrary(candidate, &error);
    if (!handle) {
      errors += "  " + candidate + ": " + error + "\n";
      continue;
    }

    auto wechat_ocr = reinterpret_cast<WechatOcrFn>(LoadSymbol(handle, "wechat_ocr"));
    auto stop_ocr = reinterpret_cast<StopOcrFn>(LoadSymbol(handle, "stop_ocr"));
    if (!wechat_ocr || !stop_ocr) {
      CloseLibrary(handle);
      errors += "  " + candidate + ": missing wechat_ocr or stop_ocr symbol\n";
      continue;
    }

    g_lib.handle = handle;
    g_lib.wechat_ocr = wechat_ocr;
    g_lib.stop_ocr = stop_ocr;
    g_lib.path = candidate;
    return;
  }

  throw std::runtime_error("failed to load wcocr library. Tried:\n" + errors);
}

extern "C" void StoreResult(const char *result) {
  g_last_result = result ? result : "";
}

napi_value MakeString(napi_env env, const std::string &value) {
  napi_value out;
  Check(env, napi_create_string_utf8(env, value.c_str(), value.size(), &out), "create string");
  return out;
}

napi_value MakeBool(napi_env env, bool value) {
  napi_value out;
  Check(env, napi_get_boolean(env, value, &out), "create boolean");
  return out;
}

napi_value GetOptions(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  Check(env, napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr), "get callback info");
  if (argc < 1) {
    throw std::runtime_error("options object is required");
  }

  napi_valuetype type;
  Check(env, napi_typeof(env, argv[0], &type), "options type");
  if (type != napi_object) {
    throw std::runtime_error("first argument must be an options object");
  }
  return argv[0];
}

struct OcrOptions {
  std::string lib_path;
  std::string ocr_exe;
  std::string wechat_dir;
  std::string wxocr_lib;
  std::string resources_dir;
  std::string image_path;
};

OcrOptions ParseOptions(napi_env env, napi_value options, bool need_image) {
  OcrOptions parsed;
  GetOptionalStringProp(env, options, "libPath", &parsed.lib_path);
  GetOptionalStringProp(env, options, "wxocrLib", &parsed.wxocr_lib);
  GetOptionalStringProp(env, options, "resourcesDir", &parsed.resources_dir);
  GetOptionalStringProp(env, options, "ocrExe", &parsed.ocr_exe);
  GetOptionalStringProp(env, options, "wechatDir", &parsed.wechat_dir);
  if (need_image) {
    parsed.image_path = GetRequiredStringProp(env, options, "imagePath");
  }
  return parsed;
}

bool CallWechatOcr(const OcrOptions &options, const char *image_path, bool collect_result) {
  if (options.ocr_exe.empty() || options.wechat_dir.empty()) {
    throw std::runtime_error("ocrExe and wechatDir are required for the legacy wcocr runtime");
  }
  LoadLibraryIfNeeded(options.lib_path);

#ifdef _WIN32
  std::wstring ocr_exe = Utf8ToWide(options.ocr_exe);
  std::wstring wechat_dir = Utf8ToWide(options.wechat_dir);
  return g_lib.wechat_ocr(ocr_exe.c_str(), wechat_dir.c_str(), image_path, collect_result ? StoreResult : nullptr);
#else
  return g_lib.wechat_ocr(options.ocr_exe.c_str(), options.wechat_dir.c_str(), image_path,
                         collect_result ? StoreResult : nullptr);
#endif
}

#ifdef __APPLE__
template <class T>
T LoadMacWevisionSymbol(void *handle, const char *name) {
  dlerror();
  void *fn = dlsym(handle, name);
  if (!fn) {
    const char *msg = dlerror();
    throw std::runtime_error(std::string("missing libwxocr symbol ") + name + ": " + (msg ? msg : "unknown error"));
  }
  return reinterpret_cast<T>(fn);
}

wevision2::DnnInferenceOptions MakeMacWevisionOptions() {
  wevision2::DnnInferenceOptions options;
  std::memset(options.prefix, 0xaa, sizeof(options.prefix));
  options.prefix[0] = 0;
  *reinterpret_cast<uint64_t *>(options.prefix + 0x08) = 1;
  *reinterpret_cast<uint64_t *>(options.prefix + 0x10) = 0x300000003ULL;
  *reinterpret_cast<uint32_t *>(options.prefix + 0x18) = 0;
  return options;
}

void LoadMacWevisionIfNeeded(const OcrOptions &options) {
  if (options.wxocr_lib.empty() && options.wechat_dir.empty()) {
    throw std::runtime_error("wxocrLib or wechatDir is required for bundled macOS WeChat OCR");
  }
  std::string lib_path = options.wxocr_lib.empty() ? (options.wechat_dir + "/libwxocr.dylib") : options.wxocr_lib;
  std::string frameworks_dir = Dirname(lib_path);
  std::string resources_dir =
      options.resources_dir.empty() ? (Dirname(frameworks_dir) + "/Resources") : options.resources_dir;

  std::lock_guard<std::mutex> lock(g_mac_wevision.mutex);
  if (g_mac_wevision.wxocr) {
    if (g_mac_wevision.lib_path != lib_path) {
      throw std::runtime_error("libwxocr is already loaded from " + g_mac_wevision.lib_path);
    }
    return;
  }

  g_mac_wevision.mmmojo = dlopen((frameworks_dir + "/libmmmojo.dylib").c_str(), RTLD_NOW | RTLD_GLOBAL);
  if (!g_mac_wevision.mmmojo) {
    const char *msg = dlerror();
    throw std::runtime_error(std::string("dlopen libmmmojo.dylib failed: ") + (msg ? msg : "unknown error"));
  }

  g_mac_wevision.wxocr = dlopen(lib_path.c_str(), RTLD_NOW | RTLD_GLOBAL);
  if (!g_mac_wevision.wxocr) {
    const char *msg = dlerror();
    throw std::runtime_error(std::string("dlopen libwxocr.dylib failed: ") + (msg ? msg : "unknown error"));
  }

  g_mac_wevision.make_from_file = LoadMacWevisionSymbol<MacWevisionLibrary::MakeFromFileFn>(
      g_mac_wevision.wxocr,
      "_ZN9wevision210ByteBuffer12MakeFromFileERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE");
  g_mac_wevision.image_decode = LoadMacWevisionSymbol<MacWevisionLibrary::ImageDecodeFn>(
      g_mac_wevision.wxocr, "_ZN9wevision211ImageDecodeENSt3__110shared_ptrINS_10ByteBufferEEE");
  g_mac_wevision.text_ctor = LoadMacWevisionSymbol<MacWevisionLibrary::TextRecognizerCtorFn>(
      g_mac_wevision.wxocr,
      "_ZN9wevision214TextRecognizerC1ERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEES9_S9_RKNS_19DnnInferenceOptionsE");
  g_mac_wevision.text_setup = LoadMacWevisionSymbol<MacWevisionLibrary::TextRecognizerSetupFn>(
      g_mac_wevision.wxocr, "_ZN9wevision214TextRecognizer16SetupRecognitionEv");
  g_mac_wevision.recognize_strings = LoadMacWevisionSymbol<MacWevisionLibrary::TextRecognizerRecognizeStringsFn>(
      g_mac_wevision.wxocr,
      "_ZN9wevision214TextRecognizer9RecognizeENSt3__110shared_ptrINS_11PixelBufferEEERNS1_6vectorINS1_12basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEENS9_ISB_EEEEPNS_11OrientationE");
  // The OCRText overload also returns box geometry + confidence per line. Treated
  // as optional so a library missing it still works via the string overload.
  {
    dlerror();
    void *fn = dlsym(
        g_mac_wevision.wxocr,
        "_ZN9wevision214TextRecognizer9RecognizeENSt3__110shared_ptrINS_11PixelBufferEEERNS1_6vectorINS_7OCRTextENS1_9allocatorIS6_EEEEPNS_11OrientationE");
    g_mac_wevision.recognize_texts = reinterpret_cast<MacWevisionLibrary::TextRecognizerRecognizeTextsFn>(fn);
  }

  g_mac_wevision.lib_path = lib_path;
  g_mac_wevision.resources_dir = resources_dir;
}

void InitMacWevisionRecognizerLocked() {
  if (g_mac_wevision.recognizer_ready) {
    return;
  }

  const std::string det_model = g_mac_wevision.resources_dir + "/text_det_fp16_v1.xnet";
  const std::string rec_model = g_mac_wevision.resources_dir + "/text_rec_fp16_v2.xnet";
  const std::string charset = g_mac_wevision.resources_dir + "/charset_zh10798.txt";
  wevision2::DnnInferenceOptions model_options = MakeMacWevisionOptions();

  g_mac_wevision.recognizer_storage.assign(4096, 0);
  g_mac_wevision.text_ctor(g_mac_wevision.recognizer_storage.data(), det_model, rec_model, charset, model_options);
  int rc = g_mac_wevision.text_setup(g_mac_wevision.recognizer_storage.data());
  if (rc != 0) {
    throw std::runtime_error("WeChat libwxocr TextRecognizer setup failed: " + std::to_string(rc));
  }
  g_mac_wevision.recognizer_ready = true;
}

std::string JsonEscape(const std::string &value) {
  std::string out;
  out.reserve(value.size() + 8);
  for (unsigned char ch : value) {
    switch (ch) {
      case '\\':
        out += "\\\\";
        break;
      case '"':
        out += "\\\"";
        break;
      case '\b':
        out += "\\b";
        break;
      case '\f':
        out += "\\f";
        break;
      case '\n':
        out += "\\n";
        break;
      case '\r':
        out += "\\r";
        break;
      case '\t':
        out += "\\t";
        break;
      default:
        if (ch < 0x20) {
          char buf[7];
          std::snprintf(buf, sizeof(buf), "\\u%04x", ch);
          out += buf;
        } else {
          out += static_cast<char>(ch);
        }
    }
  }
  return out;
}

std::string FloatToJson(float value) {
  // Compact, locale-independent float formatting; drops trailing zeros.
  char buf[32];
  std::snprintf(buf, sizeof(buf), "%.3f", value);
  std::string out(buf);
  if (out.find('.') != std::string::npos) {
    size_t last = out.find_last_not_of('0');
    if (out[last] == '.') --last;
    out.erase(last + 1);
  }
  return out;
}

std::string BoxPointsToJson(const std::vector<wevision2::Point2<float>> &box) {
  std::string json = "[";
  for (size_t i = 0; i < box.size(); ++i) {
    if (i) json += ",";
    json += "{\"x\":" + FloatToJson(box[i].x) + ",\"y\":" + FloatToJson(box[i].y) + "}";
  }
  json += "]";
  return json;
}

// Serialize one recognized line to the f-provider OcrLine shape:
//   { text, rate, left, top, right, bottom, boxPoints:[{x,y}x4], chars:[...] }
std::string OcrTextToJson(const wevision2::OCRText &line) {
  // Axis-aligned bounds derived from the (possibly rotated) box corners.
  float left = 0, top = 0, right = 0, bottom = 0;
  bool have_bounds = !line.box.empty();
  if (have_bounds) {
    left = right = line.box[0].x;
    top = bottom = line.box[0].y;
    for (const auto &p : line.box) {
      if (p.x < left) left = p.x;
      if (p.x > right) right = p.x;
      if (p.y < top) top = p.y;
      if (p.y > bottom) bottom = p.y;
    }
  }

  std::string json = "{\"text\":\"" + JsonEscape(line.text) + "\"";
  json += ",\"rate\":" + FloatToJson(line.rate);
  if (have_bounds) {
    json += ",\"left\":" + FloatToJson(left);
    json += ",\"top\":" + FloatToJson(top);
    json += ",\"right\":" + FloatToJson(right);
    json += ",\"bottom\":" + FloatToJson(bottom);
  }
  json += ",\"boxPoints\":" + BoxPointsToJson(line.box);
  json += ",\"chars\":[";
  for (size_t i = 0; i < line.chars.size(); ++i) {
    if (i) json += ",";
    json += "{\"text\":\"" + JsonEscape(line.chars[i].text) + "\",\"boxPoints\":" +
            BoxPointsToJson(line.chars[i].box) + "}";
  }
  json += "]}";
  return json;
}

std::string TextsToMacWevisionJson(const std::vector<wevision2::OCRText> &lines) {
  std::string text;
  for (size_t i = 0; i < lines.size(); ++i) {
    if (i) text += "\n";
    text += lines[i].text;
  }

  std::string line_json = "[";
  for (size_t i = 0; i < lines.size(); ++i) {
    if (i) line_json += ",";
    line_json += OcrTextToJson(lines[i]);
  }
  line_json += "]";

  // `lines` carries the geometry; `ocr_response` mirrors it for backward compat.
  std::string json = "{\"engine\":\"wechat-wevision\",\"text\":\"" + JsonEscape(text) + "\",\"lines\":";
  json += line_json;
  json += ",\"ocr_response\":";
  json += line_json;
  json += "}";
  return json;
}

// Fallback used when the OCRText overload is unavailable: text only, no geometry.
std::string LinesToMacWevisionJson(const std::vector<std::string> &lines) {
  std::string text;
  for (size_t i = 0; i < lines.size(); ++i) {
    if (i) text += "\n";
    text += lines[i];
  }

  std::string json = "{\"engine\":\"wechat-wevision\",\"text\":\"" + JsonEscape(text) + "\",\"lines\":[";
  for (size_t i = 0; i < lines.size(); ++i) {
    if (i) json += ",";
    json += "{\"text\":\"" + JsonEscape(lines[i]) + "\",\"boxPoints\":[],\"chars\":[]}";
  }
  json += "],\"ocr_response\":[";
  for (size_t i = 0; i < lines.size(); ++i) {
    if (i) json += ",";
    json += "{\"text\":\"" + JsonEscape(lines[i]) + "\",\"boxPoints\":[],\"chars\":[]}";
  }
  json += "]}";
  return json;
}

std::string MacWevisionOcrJson(const OcrOptions &options) {
  LoadMacWevisionIfNeeded(options);

  std::lock_guard<std::mutex> lock(g_mac_wevision.mutex);
  InitMacWevisionRecognizerLocked();

  auto bytes = g_mac_wevision.make_from_file(options.image_path);
  if (!bytes) {
    throw std::runtime_error("failed to read image: " + options.image_path);
  }
  auto pixel = g_mac_wevision.image_decode(bytes);
  if (!pixel) {
    throw std::runtime_error("failed to decode image: " + options.image_path);
  }

  // Preferred path: the OCRText overload returns text + box geometry + rate.
  if (g_mac_wevision.recognize_texts) {
    std::vector<wevision2::OCRText> texts;
    int rc = g_mac_wevision.recognize_texts(g_mac_wevision.recognizer_storage.data(), pixel, texts, nullptr);
    if (rc == 0) {
      return TextsToMacWevisionJson(texts);
    }
    // Fall through to the text-only path on failure rather than erroring out.
  }

  std::vector<std::string> lines;
  int rc = g_mac_wevision.recognize_strings(g_mac_wevision.recognizer_storage.data(), pixel, lines, nullptr);
  if (rc != 0) {
    throw std::runtime_error("WeChat libwxocr recognize failed: " + std::to_string(rc));
  }
  return LinesToMacWevisionJson(lines);
}
#endif

napi_value Load(napi_env env, napi_callback_info info) {
  try {
    size_t argc = 1;
    napi_value argv[1];
    Check(env, napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr), "get callback info");

    std::string lib_path;
    if (argc > 0) {
      napi_valuetype type;
      Check(env, napi_typeof(env, argv[0], &type), "lib path type");
      if (type != napi_undefined && type != napi_null) {
        if (type != napi_string) {
          throw std::runtime_error("libPath must be a string");
        }
        lib_path = GetString(env, argv[0], "libPath");
      }
    }

    LoadLibraryIfNeeded(lib_path);
    return MakeString(env, g_lib.path);
  } catch (const std::exception &e) {
    Throw(env, e.what());
    return nullptr;
  }
}

napi_value InitOcr(napi_env env, napi_callback_info info) {
  try {
    napi_value options_value = GetOptions(env, info);
    OcrOptions options = ParseOptions(env, options_value, false);
    bool ok = CallWechatOcr(options, "", false);
    return MakeBool(env, ok);
  } catch (const std::exception &e) {
    Throw(env, e.what());
    return nullptr;
  }
}

napi_value OcrJson(napi_env env, napi_callback_info info) {
  try {
    napi_value options_value = GetOptions(env, info);
    OcrOptions options = ParseOptions(env, options_value, true);
    g_last_result.clear();
    bool ok = CallWechatOcr(options, options.image_path.c_str(), true);
    if (!ok) {
      throw std::runtime_error("wechat_ocr returned false");
    }
    if (g_last_result.empty()) {
      throw std::runtime_error("wechat_ocr did not return a result");
    }
    return MakeString(env, g_last_result);
  } catch (const std::exception &e) {
    Throw(env, e.what());
    return nullptr;
  }
}

napi_value OcrMacWevisionJson(napi_env env, napi_callback_info info) {
  try {
#ifdef __APPLE__
    napi_value options_value = GetOptions(env, info);
    OcrOptions options = ParseOptions(env, options_value, true);
    return MakeString(env, MacWevisionOcrJson(options));
#else
    (void)info;
    throw std::runtime_error("macOS WeChat libwxocr OCR is only available on darwin");
#endif
  } catch (const std::exception &e) {
    Throw(env, e.what());
    return nullptr;
  }
}

napi_value Stop(napi_env env, napi_callback_info info) {
  (void)info;
  try {
    if (g_lib.handle && g_lib.stop_ocr) {
      g_lib.stop_ocr();
    }
    return MakeBool(env, true);
  } catch (const std::exception &e) {
    Throw(env, e.what());
    return nullptr;
  }
}

napi_value Unload(napi_env env, napi_callback_info info) {
  (void)info;
  try {
    if (g_lib.handle) {
      if (g_lib.stop_ocr) {
        g_lib.stop_ocr();
      }
      CloseLibrary(g_lib.handle);
      g_lib = LoadedLibrary{};
    }
    return MakeBool(env, true);
  } catch (const std::exception &e) {
    Throw(env, e.what());
    return nullptr;
  }
}

void Define(napi_env env, napi_value exports, const char *name, napi_callback callback) {
  napi_value fn;
  Check(env, napi_create_function(env, name, NAPI_AUTO_LENGTH, callback, nullptr, &fn), name);
  Check(env, napi_set_named_property(env, exports, name, fn), name);
}

napi_value Init(napi_env env, napi_value exports) {
  Define(env, exports, "load", Load);
  Define(env, exports, "init", InitOcr);
  Define(env, exports, "ocrJson", OcrJson);
  Define(env, exports, "ocrMacWevisionJson", OcrMacWevisionJson);
  Define(env, exports, "stop", Stop);
  Define(env, exports, "unload", Unload);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
