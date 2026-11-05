const passed = [{ scope: "text", status: "passed" }, { scope: "links", status: "passed" }];
const blocked = [{ scope: "text", status: "blocked" }, { scope: "links", status: "blocked" }];
const unavailable = [{ scope: "text", status: "not-scanned" }, { scope: "links", status: "not-scanned" }];

function annotation(body, author = "Public Reviewer") {
  return "{\\*\\atnid public-note}{\\*\\atnauthor " + author + "}\\chatn{\\*\\annotation{\\*\\atndate 1180187342}\\pard\\plain " + body + "}";
}
function hex(value) {
  return Array.from(new TextEncoder().encode(value), (byte) => "\\'" + byte.toString(16).padStart(2, "0")).join("");
}

/** Public synthetic fixtures exercised against the shipped worker, without a clipboard or target application. */
export function makeRtfDestinationPackageCasesV2(makeTask) {
  const fixtures = [
    { name: "rtf-complete-annotation-passed", source: "{\\rtf1\\ansi public " + annotation("ordinary annotation") + " tail}", checks: passed },
    { name: "rtf-encoded-annotation-author-blocked", source: "{\\rtf1\\ansi public " + annotation("ordinary", hex("private-text")) + "}", checks: blocked },
    { name: "rtf-body-joins-across-annotation-blocked", source: "{\\rtf1\\ansi pri" + annotation("ordinary") + "vate-text}", checks: blocked },
    { name: "rtf-uc2-footnote-passed", source: "{\\rtf1\\ansi\\uc2 body{\\footnote \\u65??}tail}", checks: passed },
    { name: "rtf-isolated-author-not-scanned", source: "{\\rtf1\\ansi body{\\*\\atnauthor Public Reviewer}}", checks: unavailable },
    { name: "rtf-long-non-link-text-passed", source: "{\\rtf1\\ansi " + "x".repeat(1024 * 1024) + "}", checks: passed },
  ];
  return fixtures.map(({ name, source, checks }) => ({ name, task: makeTask(name, name, source), checks }));
}
