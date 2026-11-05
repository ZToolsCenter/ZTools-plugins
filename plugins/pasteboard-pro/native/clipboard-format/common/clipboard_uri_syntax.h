#pragma once

#include <string_view>

namespace clipboard_codecs {

// Checks absolute URI/IRI storage syntax. Callers must enforce their native byte
// budget. It does not authorize, resolve, normalize, open, or execute a scheme.
bool IsValidStoredAbsoluteUri(std::u16string_view text);

}  // namespace clipboard_codecs
