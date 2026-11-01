// These controls change formatting only. Text-producing, charset, destination,
// field, and Unicode controls are handled explicitly by the projector.
export const RTF_FORMATTING_CONTROLS_V2 = new Set([
  "b", "i", "ul", "ulnone", "uldb", "uld", "uldash", "uldashd", "uldashdd", "ulwave",
  "ulth", "ulthd", "ulthdash", "ulthdashd", "ulthdashdd", "ulthldash", "ululdbwave",
  "strike", "striked", "scaps", "caps", "outline", "shad", "embo", "impr", "sub", "super",
  "nosupersub", "up", "dn", "fs", "cf", "cb", "highlight", "lang", "langfe", "kerning", "expnd", "expndtw",
  "charscalex", "rtlch", "ltrch", "loch", "hich", "dbch", "ql", "qr", "qc", "qj", "fi",
  "li", "ri", "lin", "rin", "sb", "sa", "sl", "slmult", "keep", "keepn", "widctlpar",
  "nowidctlpar", "intbl", "itap", "tx", "tqc", "tqr", "tqdec", "tb", "tldot", "tlhyph",
  "tlul", "tlth", "tleq", "adjustright", "aspalpha", "aspnum", "contextualspace",
  "trowd", "trgaph", "trleft", "trrh", "trql", "trqr", "trqc", "trhdr", "trkeep",
  "cellx", "clvertalt", "clvertalc", "clvertalb", "clcbpat", "clcfpat", "clshdng",
  "clbrdrt", "clbrdrl", "clbrdrb", "clbrdrr", "brdrs", "brdrw", "brdrcf", "brdrnone",
  "paperw", "paperh", "margl", "margr", "margt", "margb", "gutter", "landscape",
  "viewkind", "viewscale", "viewzk", "fet", "ftnbj", "sectd", "pard", "sectdefaultcl",
  "deftab", "hyphauto", "hyphhotz", "headery", "footery", "pgwsxn", "pghsxn",
  "deflang", "deflangfe", "adeflang", "cocoartf", "cocoatextscaling", "cocoaplatform",
  "cocoascreenfonts", "pardirnatural", "partightenfactor", "fnil", "froman", "fswiss", "fmodern", "fscript", "fdecor", "fbidi",
  "ftech", "fprq", "fbias", "red", "green", "blue", "cgray", "snext", "sbasedon",
  "sautoupd", "slink", "styrsid", "yr", "mo", "dy", "hr", "min", "sec", "version",
  "vern", "edmins", "nofpages", "nofwords", "nofchars", "nofcharsws", "id", "fromtext",
]);

export const RTF_METADATA_DESTINATIONS_V2 = new Set([
  "fonttbl", "colortbl", "expandedcolortbl", "stylesheet", "info", "title", "subject", "author", "manager",
  "company", "operator", "category", "keywords", "comment", "doccomm", "hlinkbase",
  "generator", "creatim", "revtim", "printim", "buptim", "docvar",
  "fname", "falt", "header", "headerl", "headerr", "headerf", "footer", "footerl", "footerr",
  "footerf", "footnote", "annotation", "atnid", "atnauthor", "atntime", "atndate", "atnref", "atnparent",
]);

export const RTF_TEXT_CONTROLS_V2 = new Map([
  ["par", "\n"], ["line", "\n"], ["tab", "\t"], ["cell", "\t"], ["row", "\n"],
  ["nestcell", "\t"], ["nestrow", "\n"], ["page", "\n"], ["sect", "\n"],
  ["emdash", "\u2014"], ["endash", "\u2013"], ["emspace", "\u2003"], ["enspace", "\u2002"],
  ["qmspace", "\u2005"], ["bullet", "\u2022"], ["lquote", "\u2018"], ["rquote", "\u2019"],
  ["ldblquote", "\u201c"], ["rdblquote", "\u201d"], ["zwj", "\u200d"], ["zwnj", "\u200c"],
]);

export const RTF_TEXT_SYMBOLS_V2 = new Map([
  ["\\", "\\"], ["{", "{"], ["}", "}"], ["~", "\u00a0"], ["_", "\u2011"], ["-", "\u00ad"],
  ["\r", "\n"], ["\n", "\n"],
]);

/** Static HYPERLINK instructions only; dynamic/DDE/INCLUDE fields stay incomplete. */
export function isStaticRtfHyperlinkV2(value: string): boolean {
  const quoted = '"[^"\\r\\n]*"';
  const target = '(?:' + quoted + '|[^\\s"\\\\]+)';
  const switches = '(?:\\s+\\\\[lot]\\s+' + quoted + ')*';
  return new RegExp("^\\s*HYPERLINK\\s+" + target + switches + "\\s*$", "i").test(value) ||
    new RegExp("^\\s*HYPERLINK\\s+\\\\l\\s+" + quoted + switches + "\\s*$", "i").test(value);
}
