#pragma once

#include "private_storage.h"

namespace pasteboard_storage {

struct LinkCaseResults {
  Status reparse_status = Status::invalid_request;
  Status hardlink_status = Status::invalid_request;
  Status cleanup_status = Status::invalid_request;
};

LinkCaseResults RunOwnedLinkCases(const std::wstring& root, const UserSid& user_sid);

}  // namespace pasteboard_storage
