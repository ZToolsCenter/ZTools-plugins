#include "clipboard_self_test.h"
#include "clipboard_delayed_read_fixture.h"
#include "clipboard_payload_transport.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <io.h>
#include <iostream>
#include <string>

namespace {

bool AwaitSupervisorRun() {
  const char* supervised = std::getenv("PBF_G0_SUPERVISED");
  if (supervised == nullptr || std::strcmp(supervised, "1") != 0) return true;
  std::string line;
  return std::getline(std::cin, line) && line == "RUN";
}

int RunSupervisedCaptureWireFixture() {
  const char* supervised = std::getenv("PBF_G0_SUPERVISED");
  if (supervised == nullptr || std::strcmp(supervised, "1") != 0) {
    std::fputs("supervision-required\n", stderr);
    std::fflush(stderr);
    return 64;
  }
  std::string line;
  if (!std::getline(std::cin, line) || line != "RUN") {
    std::fputs("supervision-run-required\n", stderr);
    std::fflush(stderr);
    return 64;
  }
  if (_setmode(_fileno(stdout), _O_BINARY) == -1) {
    std::fputs("stdout-binary-mode-failed\n", stderr);
    std::fflush(stderr);
    return 64;
  }
  return clipboard_format_probe::RunCaptureWireFixtureV2(&std::cout);
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  using namespace clipboard_format_probe;
  ProbeReport report;
  const bool delayed = argc == 2 && std::wstring(argv[1]) == L"--delayed-read-fixture";
  const bool capture_wire =
      argc == 2 && std::wstring(argv[1]) == L"--capture-wire-fixture";
  if (argc != 2 || (!delayed && !capture_wire &&
                    std::wstring(argv[1]) != L"--self-test")) {
    report = InvalidArguments();
    std::cout << Serialize(report) << std::endl;
    return 64;
  }
  const char* supervised = std::getenv("PBF_G0_SUPERVISED");
  if (delayed && (supervised == nullptr || std::strcmp(supervised, "1") != 0)) {
    std::cerr << "supervision-required" << std::endl;
    return 64;
  }
  if (capture_wire) return RunSupervisedCaptureWireFixture();
  if (!AwaitSupervisorRun()) return 64;
  if (delayed) return RunDelayedReadFixture();

  try {
    report = RunSelfTest();
  } catch (...) {
    ReadEnvironment(&report);
    report.cases.push_back(CaseResult{
        "probe-exception", "fail",
        "an unexpected exception stopped the isolated probe"});
  }
  std::cout << Serialize(report) << std::endl;
  return Successful(report) ? 0 : 1;
}
