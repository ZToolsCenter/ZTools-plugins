#pragma once

#include "clipboard_probe.h"

namespace clipboard_format_probe::tiff_fixtures {

FormatPayload MakeTiff(UINT format_id);
FormatPayload MakeMultipageTiff(UINT format_id);
FormatPayload Make16BitAlphaTiff(UINT format_id);
FormatPayload MakeMalformedCompressedTiff(UINT format_id);
FormatPayload MakePixelBudgetTiff(UINT format_id);

}  // namespace clipboard_format_probe::tiff_fixtures
