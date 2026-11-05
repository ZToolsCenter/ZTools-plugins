#include "clipboard_self_test.h"

#include <algorithm>
#include <iomanip>
#include <sstream>
#include <string>
#include <windows.h>

namespace clipboard_format_probe {
namespace {

std::string JsonEscape(const std::string& value) {
  std::ostringstream output;
  for (const unsigned char character : value) {
    switch (character) {
      case '"': output << "\\\""; break;
      case '\\': output << "\\\\"; break;
      case '\b': output << "\\b"; break;
      case '\f': output << "\\f"; break;
      case '\n': output << "\\n"; break;
      case '\r': output << "\\r"; break;
      case '\t': output << "\\t"; break;
      default:
        if (character < 0x20) {
          output << "\\u" << std::hex << std::setw(4) << std::setfill('0')
                 << static_cast<unsigned int>(character) << std::dec;
        } else {
          output << static_cast<char>(character);
        }
    }
  }
  return output.str();
}

std::string SerializeInternal(const ProbeReport& report) {
  std::ostringstream output;
  output << "{\"schemaVersion\":1,\"platform\":\"win32\","
         << "\"scope\":\"isolated-window-station\",\"success\":"
         << (Successful(report) ? "true" : "false") << ",\"cases\":[";
  for (std::size_t index = 0; index < report.cases.size(); ++index) {
    if (index != 0) output << ',';
    const auto& item = report.cases[index];
    const char* detail_code = item.status == "pass"
                                  ? "case-passed"
                                  : item.status == "not-run" ? "case-not-run"
                                                              : "case-failed";
    output << "{\"id\":\"" << JsonEscape(item.id) << "\",\"status\":\""
           << JsonEscape(item.status) << "\",\"detailCode\":\""
           << detail_code << "\"}";
  }
  output << "],\"environment\":{\"osVersion\":\""
         << JsonEscape(report.os_version) << "\",\"architecture\":\""
         << JsonEscape(report.architecture) << "\",\"codePage\":"
         << report.ansi_code_page << "},\"unverified\":[";
  for (std::size_t index = 0; index < report.unverified.size(); ++index) {
    if (index != 0) output << ',';
    output << '"' << JsonEscape(report.unverified[index]) << '"';
  }
  output << "],\"windowsFormatReceipts\":"
         << SerializeWindowsFormatReceipts(report.windows_format_receipts) << "}";
  return output.str();
}

}  // namespace

void ReadEnvironment(ProbeReport* report) {
  report->ansi_code_page = GetACP();
  struct VersionInfo {
    ULONG size;
    ULONG major;
    ULONG minor;
    ULONG build;
    ULONG platform;
    wchar_t service_pack[128];
  } version{};
  version.size = static_cast<ULONG>(sizeof(version));
  const HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  using RtlGetVersionFn = LONG(WINAPI*)(VersionInfo*);
  const auto get_version = ntdll == nullptr
                               ? nullptr
                               : reinterpret_cast<RtlGetVersionFn>(
                                     GetProcAddress(ntdll, "RtlGetVersion"));
  if (get_version != nullptr && get_version(&version) == 0) {
    report->os_version = std::to_string(version.major) + "." +
                         std::to_string(version.minor) + "." +
                         std::to_string(version.build);
  }

  SYSTEM_INFO system_info{};
  GetNativeSystemInfo(&system_info);
  switch (system_info.wProcessorArchitecture) {
    case PROCESSOR_ARCHITECTURE_AMD64:
      report->architecture = "x64";
      break;
    case PROCESSOR_ARCHITECTURE_ARM64:
      report->architecture = "arm64";
      break;
    case PROCESSOR_ARCHITECTURE_INTEL:
      report->architecture = "x86";
      break;
    default:
      report->architecture = "unknown";
      break;
  }
}

ProbeReport InvalidArguments() {
  ProbeReport report;
  ReadEnvironment(&report);
  report.cases.push_back(CaseResult{
      "cli-arguments", "fail", "expected one fixed test mode"});
  report.cases.push_back(CaseResult{
      "station-isolation", "not-run",
      "invalid arguments; no station or clipboard operation was attempted"});
  return report;
}

bool Successful(const ProbeReport& report) {
  return WindowsFormatReceiptsComplete(report.windows_format_receipts) &&
      !report.cases.empty() &&
      std::all_of(report.cases.begin(), report.cases.end(),
                  [](const CaseResult& item) { return item.status == "pass"; });
}

std::string Serialize(const ProbeReport& report) {
  return SerializeInternal(report);
}

}  // namespace clipboard_format_probe
