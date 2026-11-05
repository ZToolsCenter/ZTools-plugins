#include "capture_wire_v2_cases.h"

#include "../common/clipboard_capture_wire.h"
#include "../common/clipboard_sha256.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <ostream>
#include <sstream>
#include <streambuf>
#include <string>

namespace {

using namespace clipboard_format_probe;

constexpr std::uint8_t kUtf8Source[] = {'o', 'k'};
constexpr std::uint8_t kUtf16BeWithBomAndTerminator[] = {
    0xfe, 0xff, 0x00, 'o', 0x00, 'k', 0x00, 0x00};
constexpr std::uint8_t kUtf16BeBomless[] = {0x00, 'o', 0x00, 'k'};
constexpr std::uint8_t kUtf16BeBomOnly[] = {0xfe, 0xff};
constexpr std::uint8_t kUtf16BeTerminatorOnly[] = {0x00, 0x00};

struct TestRunner {
  int failures = 0;

  void Check(bool passed, const char* name) {
    std::printf("%s %s\n", passed ? "PASS" : "FAIL", name);
    if (!passed) ++failures;
  }
};

CaptureCodecV2 Codec(const std::string& encoding) {
  CaptureCodecV2 codec;
  codec.encoding = encoding;
  codec.materialization = "owned-pasteboard-data";
  return codec;
}

CaptureWireV1 ValidCapture() {
  CaptureWireV1 capture;
  capture.request_id = "fixture-v18";
  capture.platform = "macos";
  capture.expected_revision = "8";
  capture.captured_revision = "8";
  capture.observed_revision = "9";
  capture.policy_revision = "policy-v18";
  capture.partial = true;
  capture.capture_allowed = true;
  capture.local_history_allowed = true;

  CaptureWireRowV1 source;
  source.item_index = 0;
  source.native_name = "public.utf8-plain-text";
  source.bytes = kUtf8Source;
  source.byte_length = sizeof(kUtf8Source);
  source.sha256 = PortableSha256Hex(source.bytes, source.byte_length);
  source.native_codec = Codec("utf-8");
  capture.rows.push_back(source);

  CaptureWireRowV1 text;
  text.item_index = 0;
  text.native_name = "public.utf16-external-plain-text";
  text.bytes = kUtf16BeWithBomAndTerminator;
  text.byte_length = sizeof(kUtf16BeWithBomAndTerminator);
  text.sha256 = PortableSha256Hex(text.bytes, text.byte_length);
  text.derived_from = "public.utf8-plain-text";
  text.fidelity = "compatible";
  text.native_codec = Codec("utf16-external-bytes");
  text.native_codec->text = CaptureTextEvidenceV2{
      "utf-16be", true, true, "decoded-text-matches"};
  capture.rows.push_back(text);

  CaptureWireRowV1 unavailable;
  unavailable.item_index = 0;
  unavailable.native_name = "example.private";
  unavailable.captured = false;
  unavailable.reason_code = "unsupported";
  capture.rows.push_back(unavailable);
  return capture;
}

std::uint32_t ReadLittle32(const std::string& bytes, std::size_t offset) {
  std::uint32_t value = 0;
  for (std::size_t index = 0; index < 4; ++index) {
    value |= static_cast<std::uint32_t>(
                 static_cast<unsigned char>(bytes[offset + index]))
             << (index * 8);
  }
  return value;
}

std::uint64_t ReadLittle64(const std::string& bytes, std::size_t offset) {
  std::uint64_t value = 0;
  for (std::size_t index = 0; index < 8; ++index) {
    value |= static_cast<std::uint64_t>(
                 static_cast<unsigned char>(bytes[offset + index]))
             << (index * 8);
  }
  return value;
}

std::string Metadata(const std::string& frame) {
  if (frame.size() < 20) return {};
  const std::uint32_t length = ReadLittle32(frame, 8);
  if (length > frame.size() - 20) return {};
  return frame.substr(20, length);
}

bool WritesV2(const CaptureWireV1& capture, std::string* frame = nullptr) {
  std::ostringstream output(std::ios::out | std::ios::binary);
  const bool written = WriteCaptureWireV2(capture, &output);
  if (frame) *frame = output.str();
  return written;
}

bool RejectedWithoutOutput(const CaptureWireV1& capture) {
  std::ostringstream output(std::ios::out | std::ios::binary);
  return !WriteCaptureWireV2(capture, &output) && output.str().empty();
}

class FailAfterBuffer final : public std::streambuf {
 public:
  explicit FailAfterBuffer(std::uint64_t limit) : limit_(limit) {}
  std::uint64_t bytes_written = 0;

 protected:
  std::streamsize xsputn(const char*, std::streamsize count) override {
    const std::uint64_t available = limit_ - bytes_written;
    const auto accepted = std::min<std::uint64_t>(
        available, static_cast<std::uint64_t>(count));
    bytes_written += accepted;
    return static_cast<std::streamsize>(accepted);
  }

  int_type overflow(int_type character) override {
    if (traits_type::eq_int_type(character, traits_type::eof())) {
      return traits_type::not_eof(character);
    }
    if (bytes_written == limit_) return traits_type::eof();
    ++bytes_written;
    return character;
  }

 private:
  std::uint64_t limit_;
};

}  // namespace

int RunCaptureWireV2Cases() {
  TestRunner tests;
  const CaptureWireV1 valid = ValidCapture();
  std::string frame;
  const bool wrote = WritesV2(valid, &frame);
  const std::string metadata = Metadata(frame);
  const std::string expected_payload =
      std::string(reinterpret_cast<const char*>(kUtf8Source), sizeof(kUtf8Source)) +
      std::string(reinterpret_cast<const char*>(kUtf16BeWithBomAndTerminator),
                  sizeof(kUtf16BeWithBomAndTerminator));
  tests.Check(wrote && frame.substr(0, 8) == std::string("PBCAP02\n", 8) &&
                  ReadLittle32(frame, 8) == metadata.size() &&
                  ReadLittle64(frame, 12) == expected_payload.size() &&
                  frame.size() == 20 + metadata.size() + expected_payload.size() &&
                  frame.compare(20 + metadata.size(), expected_payload.size(),
                                expected_payload) == 0 &&
                  metadata.find("\"schemaVersion\":2") != std::string::npos &&
                  metadata.find("\"nativeCodec\":{\"encoding\":\"utf16-external-bytes\",\"materialization\":\"owned-pasteboard-data\",\"text\":{\"encoding\":\"utf-16be\",\"byteOrderMark\":true,\"nullTerminated\":true,\"encodingCheck\":\"decoded-text-matches\"}}") !=
                      std::string::npos,
              "v2-frame-magic-schema-codec-and-raw-bytes");

  CaptureWireV1 v1 = valid;
  for (CaptureWireRowV1& row : v1.rows) row.native_codec.reset();
  std::ostringstream v1_output(std::ios::out | std::ios::binary);
  tests.Check(WriteCaptureWireV1(v1, &v1_output) &&
                  v1_output.str().substr(0, 8) == std::string("PBCAP01\n", 8),
              "v1-without-native-codec-retains-legacy-frame");
  v1.rows[0].native_codec = Codec("utf-8");
  tests.Check(RejectedWithoutOutput(v1), "v1-rejects-native-codec-without-prefix");

  CaptureWireV1 bad = valid;
  bad.rows[0].native_codec.reset();
  tests.Check(RejectedWithoutOutput(bad), "v2-requires-codec-on-every-captured-row");
  bad = valid;
  bad.rows[2].native_codec = Codec("unavailable-must-not-have-codec");
  tests.Check(RejectedWithoutOutput(bad), "v2-unavailable-row-rejects-codec");

  bad = valid;
  bad.rows[0].native_codec->encoding.clear();
  tests.Check(RejectedWithoutOutput(bad), "v2-codec-identifier-empty-rejected");
  bad = valid;
  bad.rows[0].native_codec->encoding.assign(129, 'e');
  tests.Check(RejectedWithoutOutput(bad), "v2-codec-identifier-over-128-rejected");
  bad = valid;
  bad.rows[0].native_codec->materialization = "not/a-codec";
  tests.Check(RejectedWithoutOutput(bad), "v2-codec-identifier-character-set");
  bad = valid;
  bad.rows[0].native_codec->encoding = "utf-8\xc3\xa9";
  tests.Check(RejectedWithoutOutput(bad), "v2-codec-identifier-must-be-ascii");

  bad = valid;
  bad.rows[1].native_codec->text->byte_order_mark = false;
  tests.Check(RejectedWithoutOutput(bad), "v2-text-bom-flag-must-match-bytes");
  bad = valid;
  bad.rows[1].native_codec->text->encoding = "utf-16le";
  tests.Check(RejectedWithoutOutput(bad), "v2-text-bom-must-match-byte-order");
  bad = valid;
  bad.rows[1].byte_length -= 2;
  bad.rows[1].sha256 = PortableSha256Hex(bad.rows[1].bytes,
                                         bad.rows[1].byte_length);
  tests.Check(RejectedWithoutOutput(bad), "v2-text-required-terminator-must-exist");
  bad = valid;
  bad.rows[1].byte_length -= 1;
  bad.rows[1].sha256 = PortableSha256Hex(bad.rows[1].bytes,
                                         bad.rows[1].byte_length);
  tests.Check(RejectedWithoutOutput(bad), "v2-text-utf16-byte-length-must-be-even");
  bad = valid;
  bad.rows[1].native_codec->text->encoding_check = "guessed-from-bytes";
  tests.Check(RejectedWithoutOutput(bad), "v2-text-encoding-check-enum");
  bad = valid;
  bad.rows[1].native_codec->text->encoding = "utf-8";
  tests.Check(RejectedWithoutOutput(bad), "v2-text-evidence-requires-utf16-encoding");
  bad = valid;
  bad.rows[1].native_codec->text.reset();
  tests.Check(RejectedWithoutOutput(bad),
              "v2-compatible-derived-utf16-requires-text-evidence");
  bad = valid;
  bad.rows[1].fidelity = "exact";
  tests.Check(RejectedWithoutOutput(bad),
              "v2-text-evidence-requires-compatible-fidelity");
  bad = valid;
  bad.rows[0].native_name = "example.text-source";
  bad.rows[1].derived_from = "example.text-source";
  tests.Check(RejectedWithoutOutput(bad),
              "v2-text-evidence-requires-exact-utf8-source-name");
  CaptureWireV1 standalone = valid;
  standalone.rows[1].fidelity = "exact";
  standalone.rows[1].derived_from.clear();
  standalone.rows[1].native_codec->text.reset();
  tests.Check(WritesV2(standalone),
              "v2-standalone-exact-utf16-may-omit-text-evidence");
  CaptureWireV1 reference = standalone;
  reference.rows[1].fidelity = "reference";
  tests.Check(RejectedWithoutOutput(reference),
              "v2-standalone-reference-utf16-requires-text-evidence");
  bad = valid;
  bad.rows[1].bytes = nullptr;
  bad.rows[1].byte_length = 0;
  bad.rows[1].sha256 = PortableSha256Hex(nullptr, 0);
  bad.rows[1].native_codec->text->byte_order_mark = false;
  bad.rows[1].native_codec->text->null_terminated = false;
  tests.Check(RejectedWithoutOutput(bad), "v2-text-empty-payload-rejected");
  bad = valid;
  bad.rows[1].bytes = kUtf16BeBomOnly;
  bad.rows[1].byte_length = sizeof(kUtf16BeBomOnly);
  bad.rows[1].sha256 = PortableSha256Hex(bad.rows[1].bytes,
                                         bad.rows[1].byte_length);
  bad.rows[1].native_codec->text->null_terminated = false;
  tests.Check(RejectedWithoutOutput(bad), "v2-text-bom-only-payload-rejected");

  CaptureWireV1 bomless = valid;
  bomless.rows[1].bytes = kUtf16BeBomless;
  bomless.rows[1].byte_length = sizeof(kUtf16BeBomless);
  bomless.rows[1].sha256 = PortableSha256Hex(bomless.rows[1].bytes,
                                             bomless.rows[1].byte_length);
  bomless.rows[1].native_codec->text->byte_order_mark = false;
  bomless.rows[1].native_codec->text->null_terminated = false;
  tests.Check(WritesV2(bomless), "v2-bomless-byte-order-is-explicit-evidence");
  CaptureWireV1 unmarked_terminator = valid;
  unmarked_terminator.rows[1].native_codec->text->null_terminated = false;
  tests.Check(WritesV2(unmarked_terminator),
              "v2-does-not-infer-null-termination-from-trailing-zero");
  CaptureWireV1 emptyText = valid;
  emptyText.rows[0].bytes = nullptr;
  emptyText.rows[0].byte_length = 0;
  emptyText.rows[0].sha256 = PortableSha256Hex(nullptr, 0);
  emptyText.rows[1].bytes = kUtf16BeTerminatorOnly;
  emptyText.rows[1].byte_length = sizeof(kUtf16BeTerminatorOnly);
  emptyText.rows[1].sha256 = PortableSha256Hex(emptyText.rows[1].bytes,
                                               emptyText.rows[1].byte_length);
  emptyText.rows[1].native_codec->text->byte_order_mark = false;
  emptyText.rows[1].native_codec->text->null_terminated = true;
  tests.Check(WritesV2(emptyText),
              "v2-explicit-terminator-may-represent-empty-text");

  bad = valid;
  bad.rows[1].derived_from.clear();
  tests.Check(RejectedWithoutOutput(bad), "v2-text-evidence-requires-derived-from");
  bad = valid;
  bad.rows[1].derived_from = "missing.source";
  tests.Check(RejectedWithoutOutput(bad), "v2-text-evidence-source-must-exist");
  bad = valid;
  bad.rows[1].item_index = 1;
  bad.rows[2].item_index = 1;
  tests.Check(RejectedWithoutOutput(bad), "v2-text-source-must-be-same-item");
  bad = valid;
  bad.platform = "windows";
  tests.Check(RejectedWithoutOutput(bad), "v2-text-evidence-is-macos-only");

  bad = valid;
  bad.platform = "windows";
  bad.rows[1].native_codec->text.reset();
  bad.rows[1].native_codec->validation_code_page = 1252;
  tests.Check(WritesV2(bad), "v2-windows-code-page-accepted");
  bad.rows[1].native_codec->validation_code_page = 0;
  tests.Check(RejectedWithoutOutput(bad), "v2-windows-code-page-zero-rejected");
  bad.rows[1].native_codec->validation_code_page = 65536;
  tests.Check(RejectedWithoutOutput(bad), "v2-windows-code-page-overflow-rejected");
  bad = valid;
  bad.rows[0].native_codec->validation_code_page = 1252;
  tests.Check(RejectedWithoutOutput(bad), "v2-code-page-is-windows-only");

  FailAfterBuffer failing_buffer(17);
  std::ostream failing_output(&failing_buffer);
  tests.Check(!WriteCaptureWireV2(valid, &failing_output) &&
                  failing_buffer.bytes_written == 17,
              "v2-stream-error-reported");
  tests.Check(!WriteCaptureWireV2(valid, nullptr), "v2-null-stream-rejected");
  return tests.failures;
}
