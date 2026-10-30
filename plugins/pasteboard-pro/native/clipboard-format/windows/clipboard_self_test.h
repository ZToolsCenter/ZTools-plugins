#pragma once

#include "clipboard_format_receipts.h"

#include <string>
#include <vector>

namespace clipboard_format_probe {

struct CaseResult {
  std::string id;
  std::string status;
  std::string detail;
};

struct ProbeReport {
  std::vector<CaseResult> cases;
  std::vector<WindowsRoundTripReceipt> windows_format_receipts;
  std::vector<std::string> unverified = {
      "windows-version-matrix", "CF_DIB", "CF_DIBV5", "CF_BITMAP",
      "CF_HDROP", "CF_TEXT", "CF_OEMTEXT", "CF_LOCALE",
      "metafile-palette", "other-registered-formats",
      "general-clipboard-monitoring", "delayed-source-rendering",
      "target-application-paste", "signed-host-integration",
      "os-atomic-commit", "native-read-timeout",
      "partial-write-fault-injection", "rss-watchdog",
      "privacy-policy-integration", "cross-platform-sync",
      "jpeg-tiff-codecs", "url-color-codecs"};
  unsigned int ansi_code_page = 0;
  std::string os_version = "unknown";
  std::string architecture = "unknown";
};

ProbeReport RunSelfTest();
void ReadEnvironment(ProbeReport* report);
ProbeReport InvalidArguments();
std::string Serialize(const ProbeReport& report);
bool Successful(const ProbeReport& report);

}  // namespace clipboard_format_probe
