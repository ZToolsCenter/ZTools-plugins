// Minimal protobuf wire-format codec. See pb.h for rationale.
#include "pb.h"

#include <cstring>

namespace wechat_ocr {

// ---------- low-level writers ----------

static void WriteVarint(std::string& out, uint64_t v) {
  while (v >= 0x80) {
    out.push_back(static_cast<char>((v & 0x7F) | 0x80));
    v >>= 7;
  }
  out.push_back(static_cast<char>(v));
}

static void WriteTag(std::string& out, uint32_t fieldNumber, uint32_t wireType) {
  WriteVarint(out, (static_cast<uint64_t>(fieldNumber) << 3) | wireType);
}

static void WriteFixed32(std::string& out, uint32_t fieldNumber, float value) {
  uint32_t bits = 0;
  std::memcpy(&bits, &value, sizeof(bits));
  WriteTag(out, fieldNumber, 5);
  for (int i = 0; i < 4; ++i) out.push_back(static_cast<char>((bits >> (i * 8)) & 0xFF));
}

static void WriteString(std::string& out, uint32_t fieldNumber, const std::string& value) {
  WriteTag(out, fieldNumber, 2);
  WriteVarint(out, value.size());
  out.append(value);
}

// ---------- low-level readers ----------

namespace {

// A cursor over a byte buffer. All reads are bounds-checked and the parser
// bails out (returns false) on truncation rather than reading OOB.
class Reader {
 public:
  Reader(const uint8_t* data, std::size_t size) : data_(data), size_(size) {}

  bool empty() const { return pos_ >= size_; }

  bool ReadByte(uint8_t& out) {
    if (pos_ >= size_) return false;
    out = data_[pos_++];
    return true;
  }

  bool ReadVarint(uint64_t& out) {
    out = 0;
    int shift = 0;
    uint8_t b = 0;
    do {
      if (pos_ >= size_) return false;
      b = data_[pos_++];
      out |= static_cast<uint64_t>(b & 0x7F) << shift;
      shift += 7;
      if (shift > 64) return false;  // malformed varint
    } while (b & 0x80);
    return true;
  }

  bool ReadFixed32(uint32_t& out) {
    if (pos_ + 4 > size_) return false;
    out = 0;
    for (int i = 0; i < 4; ++i) out |= static_cast<uint32_t>(data_[pos_ + i]) << (i * 8);
    pos_ += 4;
    return true;
  }

  bool ReadBytes(std::vector<uint8_t>& out, std::size_t n) {
    if (pos_ + n > size_) return false;
    out.assign(data_ + pos_, data_ + pos_ + n);
    pos_ += n;
    return true;
  }

  bool Skip(std::size_t n) {
    if (pos_ + n > size_) return false;
    pos_ += n;
    return true;
  }

 private:
  const uint8_t* data_;
  std::size_t size_;
  std::size_t pos_ = 0;
};

}  // namespace

// ---------- request encoder ----------

std::string EncodeOcrRequest(int taskId, const std::string& picPath) {
  // PicPaths { repeated string pic_path = 1 }
  std::string picPaths;
  WriteString(picPaths, 1, picPath);

  // OcrRequest { unknow=1:int32, task_id=2:int32, pic_path=3:PicPaths }
  std::string out;
  WriteTag(out, 1, 0);  // field 1 (unknow), varint; value 0 omitted-by-default, but
  WriteVarint(out, 0);  // the C# client explicitly sets 0, so we mirror it.
  WriteTag(out, 2, 0);  // field 2 (task_id), varint
  WriteVarint(out, static_cast<uint32_t>(taskId));
  WriteString(out, 3, picPaths);  // field 3 (pic_path), length-delimited
  return out;
}

// ---------- response decoder ----------

// Recursively skip a field given its wire type. Returns false on malformed data.
static bool SkipField(Reader& r, uint32_t wireType) {
  switch (wireType) {
    case 0: {  // varint
      uint64_t v;
      return r.ReadVarint(v);
    }
    case 1: {  // 64-bit
      return r.Skip(8);
    }
    case 2: {  // length-delimited
      uint64_t len;
      if (!r.ReadVarint(len)) return false;
      return r.Skip(static_cast<std::size_t>(len));
    }
    case 5: {  // 32-bit
      return r.Skip(4);
    }
    default:
      return false;  // unknown wire type
  }
}

// Parse SingleResult.message -> OcrLine.
static bool ParseSingleResult(const uint8_t* data, std::size_t size, OcrLine& line) {
  Reader r(data, size);
  while (!r.empty()) {
    uint64_t tag;
    if (!r.ReadVarint(tag)) return false;
    uint32_t fieldNumber = tag >> 3;
    uint32_t wireType = tag & 0x7;

    switch (fieldNumber) {
      case 2: {  // single_str_utf8 (bytes, base64 of UTF8 text)
        uint64_t len;
        if (wireType != 2 || !r.ReadVarint(len)) return false;
        std::vector<uint8_t> bytes;
        if (!r.ReadBytes(bytes, static_cast<std::size_t>(len))) return false;
        // The server returns base64-encoded UTF-8 here (see C# ParseOcrResult).
        // We pass the raw (still base64) bytes to JS and decode there.
        line.text.assign(reinterpret_cast<const char*>(bytes.data()), bytes.size());
        break;
      }
      case 3: {  // single_rate (float)
        uint32_t bits;
        if (wireType != 5 || !r.ReadFixed32(bits)) return false;
        std::memcpy(&line.rate, &bits, sizeof(bits));
        break;
      }
      case 5: {  // left
        uint32_t bits;
        if (wireType != 5 || !r.ReadFixed32(bits)) return false;
        std::memcpy(&line.left, &bits, sizeof(bits));
        break;
      }
      case 6: {  // top
        uint32_t bits;
        if (wireType != 5 || !r.ReadFixed32(bits)) return false;
        std::memcpy(&line.top, &bits, sizeof(bits));
        break;
      }
      case 7: {  // right
        uint32_t bits;
        if (wireType != 5 || !r.ReadFixed32(bits)) return false;
        std::memcpy(&line.right, &bits, sizeof(bits));
        break;
      }
      case 8: {  // bottom
        uint32_t bits;
        if (wireType != 5 || !r.ReadFixed32(bits)) return false;
        std::memcpy(&line.bottom, &bits, sizeof(bits));
        break;
      }
      case 1:   // single_pos (ResultPos) -> derive 4 box points below from l/t/r/b
      case 4:   // one_result (per-character) -> ignored for line view
      case 9:   // unknown_0
      case 10:  // unknown_pos
        if (!SkipField(r, wireType)) return false;
        break;
      default:
        if (!SkipField(r, wireType)) return false;
        break;
    }
  }

  // Build 4 box points (lt, rt, rb, lb) from the bounding rect, matching the
  // original C# Converter(x,y,w,h).
  const float w = line.right - line.left;
  const float h = line.bottom - line.top;
  line.boxPoints.push_back({line.left, line.top});
  line.boxPoints.push_back({line.left + w, line.top});
  line.boxPoints.push_back({line.left + w, line.top + h});
  line.boxPoints.push_back({line.left, line.top + h});
  return true;
}

// Parse OcrResult.message (field 4 of OcrResponse).
static bool ParseOcrResult(const uint8_t* data, std::size_t size, OcrResult& out) {
  Reader r(data, size);
  while (!r.empty()) {
    uint64_t tag;
    if (!r.ReadVarint(tag)) return false;
    uint32_t fieldNumber = tag >> 3;
    uint32_t wireType = tag & 0x7;

    switch (fieldNumber) {
      case 1: {  // repeated SingleResult
        uint64_t len;
        if (wireType != 2 || !r.ReadVarint(len)) return false;
        std::vector<uint8_t> bytes;
        if (!r.ReadBytes(bytes, static_cast<std::size_t>(len))) return false;
        OcrLine line;
        if (ParseSingleResult(bytes.data(), bytes.size(), line)) out.lines.push_back(std::move(line));
        break;
      }
      case 2:  // unknown_1
      case 3:  // unknown_2
        if (!SkipField(r, wireType)) return false;
        break;
      default:
        if (!SkipField(r, wireType)) return false;
        break;
    }
  }
  return true;
}

bool DecodeOcrResponse(const uint8_t* data, std::size_t size, OcrResult& out) {
  Reader r(data, size);
  while (!r.empty()) {
    uint64_t tag;
    if (!r.ReadVarint(tag)) return false;
    uint32_t fieldNumber = tag >> 3;
    uint32_t wireType = tag & 0x7;

    switch (fieldNumber) {
      case 2: {  // task_id
        uint64_t v;
        if (wireType != 0 || !r.ReadVarint(v)) return false;
        out.taskId = static_cast<int>(v);
        break;
      }
      case 3: {  // err_code
        uint64_t v;
        if (wireType != 0 || !r.ReadVarint(v)) return false;
        out.errCode = static_cast<int>(v);
        break;
      }
      case 4: {  // ocr_result
        uint64_t len;
        if (wireType != 2 || !r.ReadVarint(len)) return false;
        std::vector<uint8_t> bytes;
        if (!r.ReadBytes(bytes, static_cast<std::size_t>(len))) return false;
        ParseOcrResult(bytes.data(), bytes.size(), out);
        break;
      }
      case 1:  // type
      default:
        if (!SkipField(r, wireType)) return false;
        break;
    }
  }
  return true;
}

}  // namespace wechat_ocr
