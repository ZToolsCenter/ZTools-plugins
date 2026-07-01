// N-API bindings for wechat_ocr.node.
//
// Exports (synchronous boot, async recognition):
//   init(dataDir) -> true | throws        boot the OCR engine once
//   ocr(imagePath) -> Promise<Result>     recognize one image
//   dispose()                              shut the engine down
//
// mmojo delivers results on its own worker thread, so each in-flight `ocr`
// wraps a ThreadSafeFunction to hop the result back onto the JS loop.
#include <napi.h>
#include <windows.h>

#include <memory>
#include <mutex>
#include <string>

#include "ocr_manager.h"

namespace {

// Global engine state. Lazily created by init(); torn down by dispose() or at
// module unload. Guarded so ocr()/dispose()/init() are safe to interleave.
struct Engine {
  std::unique_ptr<wechat_ocr::OcrManager> manager;
};

std::mutex g_engineMutex;
std::unique_ptr<Engine> g_engine;

// Per-promise context. The result is filled in on the mmojo thread, then the
// ThreadSafeFunction schedules a JS-thread call to settle the promise.
struct OcrContext {
  // Constructed explicitly from the JS-thread side; see Ocr().
  Napi::Promise::Deferred deferred;
  Napi::ThreadSafeFunction tsfn;
  wechat_ocr::OcrOutcome outcome;
  bool settled = false;
  OcrContext(Napi::Promise::Deferred d, Napi::ThreadSafeFunction t)
      : deferred(d), tsfn(t) {}
};

// Runs on the JS main thread (via tsfn) to settle the promise.
void CallJs(Napi::Env env, Napi::Function, OcrContext* ctx) {
  if (!env || !ctx || ctx->settled) return;
  ctx->settled = true;

  const auto& outcome = ctx->outcome;
  if (outcome.ok) {
    auto result = Napi::Object::New(env);
    result.Set("ok", Napi::Boolean::New(env, true));
    result.Set("taskId", Napi::Number::New(env, outcome.taskId));

    auto lines = Napi::Array::New(env, outcome.result.lines.size());
    for (size_t i = 0; i < outcome.result.lines.size(); ++i) {
      const auto& line = outcome.result.lines[i];
      auto obj = Napi::Object::New(env);
      // single_str_utf8 is raw UTF-8 bytes from the protobuf `bytes` field;
      // Napi::String interprets std::string as UTF-8, so this is a direct copy.
      obj.Set("text", Napi::String::New(env, line.text));
      obj.Set("rate", Napi::Number::New(env, line.rate));
      obj.Set("left", Napi::Number::New(env, line.left));
      obj.Set("top", Napi::Number::New(env, line.top));
      obj.Set("right", Napi::Number::New(env, line.right));
      obj.Set("bottom", Napi::Number::New(env, line.bottom));

      auto box = Napi::Array::New(env, line.boxPoints.size());
      for (size_t j = 0; j < line.boxPoints.size(); ++j) {
        auto pt = Napi::Object::New(env);
        pt.Set("x", Napi::Number::New(env, line.boxPoints[j].x));
        pt.Set("y", Napi::Number::New(env, line.boxPoints[j].y));
        box.Set(j, pt);
      }
      obj.Set("boxPoints", box);
      lines.Set(i, obj);
    }
    result.Set("lines", lines);
    ctx->deferred.Resolve(result);
  } else {
    auto err = Napi::Object::New(env);
    err.Set("ok", Napi::Boolean::New(env, false));
    err.Set("error", Napi::String::New(env, outcome.errorMessage));
    err.Set("taskId", Napi::Number::New(env, outcome.taskId));
    ctx->deferred.Resolve(err);  // resolve with {ok:false} for ergonomic awaiting
  }
  ctx->tsfn.Release();
  delete ctx;
}

// JS-facing init(dataDir). dataDir = wco_data directory.
Napi::Value InitEngine(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "init(dataDir) expects a string").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string utf8Dir = info[0].As<Napi::String>().Utf8Value();

  // Convert UTF-8 path to wide for Win32 + mmojo.
  int wlen = MultiByteToWideChar(CP_UTF8, 0, utf8Dir.c_str(), -1, nullptr, 0);
  std::wstring dataDir(wlen - 1, L'\0');  // exclude the NUL terminator
  MultiByteToWideChar(CP_UTF8, 0, utf8Dir.c_str(), -1, &dataDir[0], wlen);

  std::lock_guard<std::mutex> lock(g_engineMutex);
  if (g_engine && g_engine->manager) {
    return Napi::Boolean::New(env, true);  // already started
  }

  // Pick the dll that matches the process arch: x64 -> mmmojo_64.dll, else mmmojo.dll.
#if defined(_WIN64)
  std::wstring dllPath = dataDir + L"\\mmmojo_64.dll";
#else
  std::wstring dllPath = dataDir + L"\\mmmojo.dll";
#endif

  auto manager = std::make_unique<wechat_ocr::OcrManager>(dataDir, dllPath);
  std::string err;
  if (!manager->Start(&err)) {
    Napi::Error::New(env, "WeChatOCR init failed: " + err).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  g_engine = std::make_unique<Engine>();
  g_engine->manager = std::move(manager);
  return Napi::Boolean::New(env, true);
}

// JS-facing ocr(imagePath) -> Promise.
Napi::Value Ocr(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);

  if (info.Length() < 1 || !info[0].IsString()) {
    deferred.Reject(Napi::TypeError::New(env, "ocr(imagePath) expects a string").Value());
    return deferred.Promise();
  }

  std::string utf8Path = info[0].As<Napi::String>().Utf8Value();
  int wlen = MultiByteToWideChar(CP_UTF8, 0, utf8Path.c_str(), -1, nullptr, 0);
  std::wstring imagePath(wlen - 1, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, utf8Path.c_str(), -1, &imagePath[0], wlen);

  wechat_ocr::OcrManager* manager = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_engineMutex);
    if (g_engine) manager = g_engine->manager.get();
  }
  if (!manager) {
    auto err = Napi::Object::New(env);
    err.Set("ok", Napi::Boolean::New(env, false));
    err.Set("error", Napi::String::New(env, "OCR engine not initialized"));
    deferred.Resolve(err);
    return deferred.Promise();
  }

  auto tsfn = Napi::ThreadSafeFunction::New(env, Napi::Function(), "wechat_ocr_cb", 0, 1);
  auto ctx = new OcrContext(deferred, tsfn);

  // Hold a handle to ctx so we can fail synchronously if Submit rejects.
  int taskId = manager->Submit(imagePath, [ctx](const wechat_ocr::OcrOutcome& outcome) {
    // mmojo callback thread: copy result into ctx, hop to JS thread.
    ctx->outcome = outcome;
    ctx->tsfn.NonBlockingCall(ctx, CallJs);
  });

  if (taskId < 0) {
    // Failed to enqueue: settle the promise with a failure object right away.
    auto err = Napi::Object::New(env);
    err.Set("ok", Napi::Boolean::New(env, false));
    err.Set("error", Napi::String::New(env, "OCR task queue full or engine not connected"));
    deferred.Resolve(err);
    ctx->tsfn.Release();
    delete ctx;
  }
  return deferred.Promise();
}

Napi::Value Dispose(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::lock_guard<std::mutex> lock(g_engineMutex);
  if (g_engine && g_engine->manager) g_engine->manager->Shutdown();
  g_engine.reset();
  return env.Undefined();
}

Napi::Object Initialize(Napi::Env env, Napi::Object exports) {
  exports.Set("init", Napi::Function::New(env, InitEngine));
  exports.Set("ocr", Napi::Function::New(env, Ocr));
  exports.Set("dispose", Napi::Function::New(env, Dispose));
  return exports;
}

}  // namespace

NODE_API_MODULE(wechat_ocr, Initialize)
