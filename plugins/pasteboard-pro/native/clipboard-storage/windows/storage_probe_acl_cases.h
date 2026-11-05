#pragma once
#include "private_storage.h"

namespace pasteboard_storage {
struct AclCaseResults {
  Status null_dacl = Status::invalid_request;
  Status empty_dacl = Status::invalid_request;
  Status extra_principal = Status::invalid_request;
  Status restore = Status::invalid_request;
};
AclCaseResults RunOwnedAclCases(HANDLE object, const UserSid& user_sid);
}  // namespace pasteboard_storage
