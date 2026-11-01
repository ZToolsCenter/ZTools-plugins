#include "capture_wire_cases.h"

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
#include <vector>

namespace {

using namespace clipboard_format_probe;

constexpr std::uint8_t kBinaryPayload[] = {'h', 'i', 0, '!'};
constexpr char kBinarySha256[] =
    "68371e0ff4e82803e80533fe6c51aa66174dc492fab0254aa4bba0a054501ec0";
constexpr char kEmptySha256[] =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
constexpr std::uint64_t kMaximumPayloadBytes = 200ULL * 1024 * 1024;

struct TestRunner {
  int failures = 0;

  void Check(bool passed, const char* name) {
    std::printf("%s %s\n", passed ? "PASS" : "FAIL", name);
    if (!passed) ++failures;
  }
};

CaptureWireV1 ValidCapture() {
  CaptureWireV1 capture;
  capture.request_id = "fixture-v17";
  capture.platform = "macos";
  capture.expected_revision = "7";
  capture.captured_revision = "7";
  capture.observed_revision = "8";
  capture.policy_revision = "policy\"雪\n";
  capture.partial = true;
  capture.capture_allowed = true;
  capture.local_history_allowed = true;
  capture.cloud_upload_allowed = false;

  CaptureWireRowV1 captured;
  captured.item_index = 0;
  captured.native_name = "public.utf8-plain-text";
  captured.bytes = kBinaryPayload;
  captured.byte_length = sizeof(kBinaryPayload);
  captured.sha256 = kBinarySha256;
  capture.rows.push_back(captured);

  CaptureWireRowV1 unavailable;
  unavailable.item_index = 0;
  unavailable.native_name = "example.private";
  unavailable.captured = false;
  unavailable.reason_code = "unsupported";
  capture.rows.push_back(unavailable);

  CaptureWireRowV1 empty;
  empty.item_index = 1;
  empty.native_name = "example.empty";
  empty.sha256 = kEmptySha256;
  capture.rows.push_back(empty);
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

bool WritesSuccessfully(const CaptureWireV1& capture) {
  std::ostringstream output(std::ios::out | std::ios::binary);
  return WriteCaptureWireV1(capture, &output) && !output.str().empty();
}

bool RejectedWithoutOutput(const CaptureWireV1& capture) {
  std::ostringstream output(std::ios::out | std::ios::binary);
  return !WriteCaptureWireV1(capture, &output) && output.str().empty();
}

class CountingBuffer final : public std::streambuf {
 public:
  std::uint64_t bytes_written = 0;
  std::array<char, 20> prefix{};

 protected:
  std::streamsize xsputn(const char* source, std::streamsize count) override {
    const auto amount = static_cast<std::uint64_t>(count);
    const std::uint64_t prefix_room = prefix.size() -
        std::min<std::uint64_t>(bytes_written, prefix.size());
    const std::size_t copy = static_cast<std::size_t>(
        std::min<std::uint64_t>(prefix_room, amount));
    if (copy != 0) {
      std::copy_n(source, copy,
                  prefix.begin() + static_cast<std::size_t>(bytes_written));
    }
    bytes_written += amount;
    return count;
  }

  int_type overflow(int_type character) override {
    if (traits_type::eq_int_type(character, traits_type::eof())) {
      return traits_type::not_eof(character);
    }
    if (bytes_written < prefix.size()) {
      prefix[static_cast<std::size_t>(bytes_written)] =
          traits_type::to_char_type(character);
    }
    ++bytes_written;
    return character;
  }
};

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

CaptureWireV1 EmptyRows(std::size_t count) {
  CaptureWireV1 capture = ValidCapture();
  capture.rows.clear();
  capture.partial = false;
  for (std::size_t index = 0; index < count; ++index) {
    CaptureWireRowV1 row;
    row.item_index = static_cast<std::uint32_t>(index / 32);
    row.native_name = "format-" + std::to_string(index);
    row.sha256 = kEmptySha256;
    capture.rows.push_back(row);
  }
  return capture;
}

CaptureWireV1 OversizedMetadataCapture() {
  CaptureWireV1 capture = ValidCapture();
  capture.rows.clear();
  capture.partial = false;
  for (std::uint32_t item = 0; item < 32; ++item) {
    const std::string root = "r" + std::string(511, 'r');
    for (std::uint32_t row_index = 0; row_index < 32; ++row_index) {
      CaptureWireRowV1 row;
      row.item_index = item;
      if (row_index == 0) {
        row.native_name = root;
      } else {
        const std::string prefix = "f" + std::to_string(row_index);
        row.native_name = prefix + std::string(512 - prefix.size(), 'c');
        row.derived_from = root;
      }
      row.sha256 = kEmptySha256;
      capture.rows.push_back(row);
    }
  }
  return capture;
}

CaptureWireV1 MetadataBoundaryBase() {
  CaptureWireV1 capture = EmptyRows(1024);
  capture.policy_revision = "p";
  for (std::uint32_t item = 0; item < 32; ++item) {
    const std::string root = "r" + std::string(489, 'r');
    for (std::uint32_t row_index = 0; row_index < 32; ++row_index) {
      CaptureWireRowV1& row = capture.rows[item * 32 + row_index];
      if (row_index == 0) {
        row.native_name = root;
      } else {
        const std::string prefix = "f" + std::to_string(row_index);
        row.native_name = prefix + std::string(512 - prefix.size(), 'c');
      }
    }
  }
  return capture;
}

CaptureWireV1 WithDerivedRows(CaptureWireV1 capture, std::size_t count) {
  for (std::uint32_t item = 0; item < 32 && count != 0; ++item) {
    const std::string& root = capture.rows[item * 32].native_name;
    for (std::uint32_t row = 1; row < 32 && count != 0; ++row, --count) {
      capture.rows[item * 32 + row].derived_from = root;
    }
  }
  return capture;
}

bool MetadataBudgetExactAndPlusOne() {
  constexpr std::size_t maximum_metadata_bytes = 1024 * 1024;
  const CaptureWireV1 base = MetadataBoundaryBase();
  std::size_t low = 0;
  std::size_t high = 32 * 31;
  while (low < high) {
    const std::size_t middle = low + (high - low + 1) / 2;
    if (WritesSuccessfully(WithDerivedRows(base, middle))) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  if (low == 32 * 31) return false;

  CaptureWireV1 exact = WithDerivedRows(base, low);
  CountingBuffer current_buffer;
  std::ostream current_output(&current_buffer);
  if (!WriteCaptureWireV1(exact, &current_output)) return false;
  const std::string prefix(current_buffer.prefix.begin(), current_buffer.prefix.end());
  const std::size_t current_length = ReadLittle32(prefix, 8);
  if (current_length > maximum_metadata_bytes ||
      maximum_metadata_bytes - current_length > 511) {
    return false;
  }
  exact.policy_revision.append(maximum_metadata_bytes - current_length, 'p');

  CountingBuffer exact_buffer;
  std::ostream exact_output(&exact_buffer);
  const bool exact_accepted = WriteCaptureWireV1(exact, &exact_output) &&
      ReadLittle32(std::string(exact_buffer.prefix.begin(), exact_buffer.prefix.end()), 8) ==
          maximum_metadata_bytes;
  exact.policy_revision.push_back('p');
  CountingBuffer over_buffer;
  std::ostream over_output(&over_buffer);
  return exact_accepted && !WriteCaptureWireV1(exact, &over_output) &&
      over_buffer.bytes_written == 0;
}

std::string FrameMetadata(const std::string& frame) {
  if (frame.size() < 20) return {};
  const std::uint32_t length = ReadLittle32(frame, 8);
  if (frame.size() < 20 + length) return {};
  return frame.substr(20, length);
}

}  // namespace

int RunCaptureWireCases() {
  TestRunner tests;
  const std::uint8_t abc[] = {'a', 'b', 'c'};
  std::array<std::uint8_t, 64> repeated_a{};
  repeated_a.fill('a');
  tests.Check(PortableSha256Hex(nullptr, 0) == kEmptySha256,
              "sha256-kat-empty");
  tests.Check(PortableSha256Hex(abc, sizeof(abc)) ==
                  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
              "sha256-kat-abc");
  tests.Check(PortableSha256Hex(repeated_a.data(), 55) ==
                  "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318",
              "sha256-kat-55-byte-padding-boundary");
  tests.Check(PortableSha256Hex(repeated_a.data(), 56) ==
                  "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a",
              "sha256-kat-56-byte-padding-boundary");
  tests.Check(PortableSha256Hex(repeated_a.data(), 64) ==
                  "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb",
              "sha256-kat-64-byte-block-boundary");

  const CaptureWireV1 valid = ValidCapture();
  std::ostringstream output(std::ios::out | std::ios::binary);
  const bool wrote = WriteCaptureWireV1(valid, &output);
  const std::string frame = output.str();
  const std::string expected_metadata =
      R"json({"schemaVersion":1,"requestId":"fixture-v17","platform":"macos","expectedRevision":"7","capturedRevision":"7","observedRevision":"8","captureState":"partial","sourceAttribution":"unknown","policy":{"revision":"policy\"雪\n","captureAllowed":true,"localHistoryAllowed":true,"cloudUploadAllowed":false},"representations":[{"itemIndex":0,"nativeName":"public.utf8-plain-text","state":"captured","offset":0,"byteLength":4,"sha256":"68371e0ff4e82803e80533fe6c51aa66174dc492fab0254aa4bba0a054501ec0","fidelity":"exact"},{"itemIndex":0,"nativeName":"example.private","state":"unavailable","reasonCode":"unsupported"},{"itemIndex":1,"nativeName":"example.empty","state":"captured","offset":4,"byteLength":0,"sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","fidelity":"exact"}]})json";
  const std::string metadata = FrameMetadata(frame);
  const std::string magic("PBCAP01\n", 8);
  const std::size_t payload_offset = 20 + metadata.size();
  tests.Check(wrote && frame.size() >= 20 && frame.substr(0, 8) == magic &&
                  ReadLittle32(frame, 8) == expected_metadata.size() &&
                  ReadLittle64(frame, 12) == sizeof(kBinaryPayload) &&
                  metadata == expected_metadata &&
                  frame.size() == payload_offset + sizeof(kBinaryPayload) &&
                  frame.compare(payload_offset,
                                sizeof(kBinaryPayload),
                                reinterpret_cast<const char*>(kBinaryPayload),
                                sizeof(kBinaryPayload)) == 0,
              "wire-canonical-frame-binary-payload-and-json-escaping");

  CaptureWireV1 bad = valid;
  bad.capture_allowed = false;
  tests.Check(RejectedWithoutOutput(bad), "wire-capture-policy-denied-no-prefix");
  bad = valid;
  bad.local_history_allowed = false;
  tests.Check(RejectedWithoutOutput(bad), "wire-local-history-denied-no-prefix");
  bad = valid;
  bad.cloud_upload_allowed = false;
  tests.Check(WritesSuccessfully(bad), "wire-cloud-denial-remains-independent");
  bad = valid;
  bad.partial = false;
  tests.Check(RejectedWithoutOutput(bad), "wire-ready-rejects-unavailable-row");
  bad = valid;
  bad.rows.erase(bad.rows.begin() + 1);
  tests.Check(RejectedWithoutOutput(bad), "wire-partial-requires-unavailable-row");

  bad = valid;
  bad.request_id = "has spaces";
  tests.Check(RejectedWithoutOutput(bad), "wire-request-id-core-identifier");
  bad = valid;
  bad.request_id.assign(129, 'a');
  tests.Check(RejectedWithoutOutput(bad), "wire-request-id-limit");
  bad = valid;
  bad.platform = "other";
  tests.Check(RejectedWithoutOutput(bad), "wire-platform-enum");
  bad = valid;
  bad.policy_revision.assign(513, 'p');
  tests.Check(RejectedWithoutOutput(bad), "wire-policy-revision-limit");
  bad = valid;
  bad.policy_revision = std::string("\xed\xa0\x80", 3);
  tests.Check(RejectedWithoutOutput(bad), "wire-invalid-utf8-metadata-rejected");

  bad = valid;
  bad.policy_revision = " \t\v\f\r\n\xc2\xa0\xe1\x9a\x80\xe2\x80\x80\xe2\x80\x81\xe2\x80\x82\xe2\x80\x83\xe2\x80\x84\xe2\x80\x85\xe2\x80\x86\xe2\x80\x87\xe2\x80\x88\xe2\x80\x89\xe2\x80\x8a\xe2\x80\xa8\xe2\x80\xa9\xe2\x80\xaf\xe2\x81\x9f\xe3\x80\x80\xef\xbb\xbf";
  tests.Check(RejectedWithoutOutput(bad), "wire-policy-whitespace-only-rejected");
  bad = valid;
  bad.expected_revision = "18446744073709551616";
  bad.captured_revision = bad.expected_revision;
  tests.Check(RejectedWithoutOutput(bad), "wire-uint64-revision-overflow");
  bad = valid;
  bad.expected_revision = "07";
  bad.captured_revision = "07";
  tests.Check(RejectedWithoutOutput(bad), "wire-revision-leading-zero-rejected");
  bad = valid;
  bad.expected_revision = "7";
  bad.captured_revision = "9";
  tests.Check(RejectedWithoutOutput(bad), "wire-expected-captured-revision-mismatch");
  bad = valid;
  bad.expected_revision = "18446744073709551615";
  bad.captured_revision = bad.expected_revision;
  bad.observed_revision = bad.expected_revision;
  tests.Check(WritesSuccessfully(bad), "wire-uint64-revision-maximum-accepted");
  bad.platform = "windows";
  bad.expected_revision = "4294967295";
  bad.captured_revision = bad.expected_revision;
  bad.observed_revision = bad.expected_revision;
  tests.Check(WritesSuccessfully(bad), "wire-windows-uint32-revision-maximum");
  bad.observed_revision = "4294967296";
  tests.Check(RejectedWithoutOutput(bad), "wire-windows-uint32-revision-overflow");

  bad = valid;
  bad.rows[0].native_name = "bad\nname";
  tests.Check(RejectedWithoutOutput(bad), "wire-native-name-control-rejected");
  bad = valid;
  bad.rows[0].native_name = std::string("\xc0\xaf", 2);
  tests.Check(RejectedWithoutOutput(bad), "wire-native-name-invalid-utf8-rejected");
  bad = valid;
  bad.rows[1].native_name = bad.rows[0].native_name;
  tests.Check(RejectedWithoutOutput(bad), "wire-duplicate-name-within-item-rejected");
  bad = valid;
  bad.rows[0].item_index = 32;
  tests.Check(RejectedWithoutOutput(bad), "wire-item-index-over-31-rejected");
  bad = valid;
  bad.rows[0].item_index = 1;
  tests.Check(RejectedWithoutOutput(bad), "wire-item-order-must-not-decrease");
  bad = valid;
  bad.rows[1].reason_code = "private";
  tests.Check(RejectedWithoutOutput(bad), "wire-unavailable-reason-enum");
  bad = valid;
  bad.rows[0].fidelity = "approximate";
  tests.Check(RejectedWithoutOutput(bad), "wire-fidelity-enum");
  bad = valid;
  bad.rows[0].sha256[0] = 'A';
  tests.Check(RejectedWithoutOutput(bad), "wire-sha256-lowercase-format");
  bad = valid;
  bad.rows[0].sha256[0] = '0';
  tests.Check(RejectedWithoutOutput(bad), "wire-sha256-must-match-original-bytes");
  bad = valid;
  bad.rows[0].bytes = nullptr;
  tests.Check(RejectedWithoutOutput(bad), "wire-nonzero-length-requires-bytes");

  bad = EmptyRows(33);
  for (CaptureWireRowV1& row : bad.rows) row.item_index = 0;
  tests.Check(RejectedWithoutOutput(bad), "wire-per-item-row-limit-plus-one");
  bad = EmptyRows(1025);
  tests.Check(RejectedWithoutOutput(bad), "wire-total-row-limit-plus-one");
  CaptureWireV1 rows_at_limit = EmptyRows(1024);
  CountingBuffer rows_buffer;
  std::ostream rows_output(&rows_buffer);
  tests.Check(WriteCaptureWireV1(rows_at_limit, &rows_output) &&
                  rows_buffer.bytes_written > 20,
              "wire-total-row-limit-accepted");

  bad = OversizedMetadataCapture();
  tests.Check(RejectedWithoutOutput(bad), "wire-metadata-budget-plus-one-no-prefix");
  tests.Check(MetadataBudgetExactAndPlusOne(),
              "wire-metadata-budget-exact-boundary-and-plus-one");

  bad = EmptyRows(1);
  bad.rows[0].native_name.assign(513, 'n');
  tests.Check(RejectedWithoutOutput(bad), "wire-native-name-length-plus-one");

  bad = EmptyRows(1);
  bad.rows[0].derived_from = bad.rows[0].native_name;
  tests.Check(RejectedWithoutOutput(bad), "wire-derived-from-self-rejected");
  bad = EmptyRows(1);
  bad.rows[0].derived_from = "missing.format";
  tests.Check(RejectedWithoutOutput(bad), "wire-derived-from-missing-rejected");
  bad = EmptyRows(2);
  bad.rows[0].derived_from = bad.rows[1].native_name;
  bad.rows[1].derived_from = bad.rows[0].native_name;
  tests.Check(RejectedWithoutOutput(bad), "wire-derived-from-cycle-rejected");
  bad = ValidCapture();
  bad.rows[0].derived_from = bad.rows[1].native_name;
  tests.Check(RejectedWithoutOutput(bad), "wire-derived-from-unavailable-rejected");
  bad = EmptyRows(2);
  bad.rows[0].derived_from = bad.rows[1].native_name;
  bad.rows[1].item_index = 1;
  bad.rows[1].native_name = "other.item.format";
  tests.Check(RejectedWithoutOutput(bad), "wire-derived-from-cross-item-rejected");
  bad = EmptyRows(2);
  bad.rows[1].derived_from = bad.rows[0].native_name;
  tests.Check(WritesSuccessfully(bad), "wire-derived-from-captured-reference-accepted");

  bad = EmptyRows(0);
  tests.Check(RejectedWithoutOutput(bad), "wire-empty-inventory-rejected");

  bad = ValidCapture();
  bad.rows.clear();
  bad.partial = true;
  CaptureWireRowV1 unavailable;
  unavailable.captured = false;
  unavailable.native_name = "only.unavailable";
  unavailable.reason_code = "failed";
  bad.rows.push_back(unavailable);
  tests.Check(WritesSuccessfully(bad), "wire-all-unavailable-remains-partial");

  CountingBuffer failed_prefix_buffer;
  FailAfterBuffer failing_buffer(25);
  std::ostream failing_output(&failing_buffer);
  tests.Check(!WriteCaptureWireV1(valid, &failing_output) &&
                  failing_buffer.bytes_written == 25,
              "wire-stream-partial-write-returns-false");
  tests.Check(!WriteCaptureWireV1(valid, nullptr), "wire-null-stream-returns-false");

  std::vector<std::uint8_t> maximum_payload(
      static_cast<std::size_t>(kMaximumPayloadBytes + 1), 0);
  CaptureWireV1 maximum = EmptyRows(1);
  maximum.rows[0].byte_length = static_cast<std::size_t>(kMaximumPayloadBytes);
  maximum.rows[0].bytes = maximum_payload.data();
  maximum.rows[0].sha256 =
      "72abf2ca8f36943ebe2e49ca3a51d409ca5f0bfcffab6c9d25643c17c32889da";
  CountingBuffer maximum_buffer;
  std::ostream maximum_output(&maximum_buffer);
  const bool maximum_written = WriteCaptureWireV1(maximum, &maximum_output);
  const std::uint32_t maximum_metadata_length = ReadLittle32(
      std::string(maximum_buffer.prefix.begin(), maximum_buffer.prefix.end()), 8);
  tests.Check(maximum_written &&
                  maximum_buffer.bytes_written == 20ULL + maximum_metadata_length +
                      kMaximumPayloadBytes,
              "wire-payload-budget-exact-boundary-accepted");
  maximum.rows[0].byte_length =
      static_cast<std::size_t>(kMaximumPayloadBytes + 1);
  maximum.rows[0].sha256 =
      "1de02a61d877048560aa8103b7df8deddb4d28f5e20dd6df0bda600e3e4f153e";
  CountingBuffer over_budget_buffer;
  std::ostream over_budget_output(&over_budget_buffer);
  tests.Check(!WriteCaptureWireV1(maximum, &over_budget_output) &&
                  over_budget_buffer.bytes_written == 0,
              "wire-payload-budget-plus-one-no-prefix");

  return tests.failures == 0 ? 0 : 1;
}
