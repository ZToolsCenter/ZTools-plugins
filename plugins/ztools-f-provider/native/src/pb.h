// Minimal protobuf wire-format codec for WeChatOCR's request/response.
//
// We hand-roll the wire format instead of pulling in libprotobuf: the schema
// (ocr_protobuf.proto) is tiny and stable, and avoiding the library keeps the
// .node build dependency-free (apart from mmmojo/WeChatOCR.exe themselves).
//
// Wire types: 0=varint, 1=64bit, 2=length-delimited, 5=32bit.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace wechat_ocr {

struct BoxPoint {
  float x = 0;
  float y = 0;
};

struct OcrLine {
  std::string text;
  float rate = 0;
  float left = 0;
  float top = 0;
  float right = 0;
  float bottom = 0;
  std::vector<BoxPoint> boxPoints;
};

struct OcrResult {
  int taskId = 0;
  int errCode = 0;
  std::vector<OcrLine> lines;
};

// Serialize an OcrRequest { unknow=0, task_id, pic_path{[picPath]} }.
std::string EncodeOcrRequest(int taskId, const std::string& picPath);

// Parse an OcrResponse byte buffer into `out`. Returns false on malformed data.
bool DecodeOcrResponse(const uint8_t* data, std::size_t size, OcrResult& out);

}  // namespace wechat_ocr
