#pragma once

#include "clipboard_formats.h"

namespace clipboard_format_probe::test_fixtures {

FormatPayload MakeText(UINT id);
FormatPayload MakeHtml(UINT id);
FormatPayload MakeHtmlFragmentOnly(UINT id);
FormatPayload MakeRtf(UINT id);
FormatPayload MakePng(UINT id);
FormatPayload MakeDib(UINT id, bool v5);
FormatPayload MakeBitmap(UINT id);
FormatPayload MakePalette();

}  // namespace clipboard_format_probe::test_fixtures
