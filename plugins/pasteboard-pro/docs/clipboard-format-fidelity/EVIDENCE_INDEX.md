# Clipboard format fidelity evidence index

This index makes the validation links in this plugin documentation portable in a normal Git checkout.

## Archive boundary

The historical raw archive under `artifacts/pasteboardpro/clipboard-format-g0/` is ignored by Git and is not included in the plugin PR. Paths to those raw files in earlier records were local-only references; they are not remotely available evidence. The archive is left untouched. This PR carries only the small, explicitly listed v0.32 receipts below.

The v0.32 root receipt is a frozen historical phase record. It does not revalidate the current PR or release. Every root receipt from v0.10 through v0.32 records `gateComplete: false`; the original G0–G4 objective remains incomplete. A local PASS means only that the named bounded check passed on its stated fixture/runtime. It does not establish complete clipboard fidelity, a real host integration, actual application paste behavior, or acceptance across operating systems.

The copied receipts contain historical local absolute path metadata in some JSON fields. No credential files, tokens, native binaries, ZIP archives, source capsules, or source snapshots are included. The ignored raw archive and its original files were not modified. The v0.32 documentationAudit/spec-unchanged statement belongs to that frozen historical receipt. This PR now changes artifact link targets in 18 of the existing 20 documents; exactly three targets in TECHNICAL_PLAN sections 1–11 change, with link labels and technical prose preserved. The current docs are not claimed byte-identical to the v0.32 snapshot.

## v0.32 receipts copied with this PR

The 36 copied source receipt files are byte-for-byte identical to the local source receipts. Verify them with [SHA256SUMS](validation/v032/SHA256SUMS); the manifest SHA256 is `5d95b01ed3e5a26fff56db0cc48a2ad0682079e8d120449fa0070e5f092b1756`. The original root sidecar is also copied unchanged.

- Root evidence: [JSON](validation/v032/v032-root-evidence.json), [original SHA256 sidecar](validation/v032/v032-root-evidence.sha256). Root JSON SHA256: `dcec9b26ef8b662d2a58188ba6c177248ac3cfe8d4740361dd8c9c6a7f10ec09`.
- Independent review: [JSON](validation/v032/v032-independent-review.json). SHA256: `8e2b7bf2feec19e647721f00e58316876f8a47491c1e75ce2863f3196e03e69f`. Its conclusion is limited to source/tests/package graph and documentation; the reviewer did not run tests or inspect the installed host, OS clipboard, or target-app paste.
- Exact final check receipt: [checks.json](validation/v032/v032-exact-final-checks-02/checks.json) plus stdout/stderr files for all eight commands in the same folder. The frozen run records 15 relevant Vitest files with 157 passing tests under Node and 157 under Electron Node, and six type/build/workspace/package-contract commands with exit code 0. This was a bounded run, not a full workspace rerun.
- Packaged CJS control and result receipts: Node and Electron each have a v0.31 red control with 22/35 assertions passing and 13 expected failures, and a v0.32 green run with 35/35 passing. The four result JSON files, four process JSON files, and all eight stdout/stderr files are under `validation/v032/v032-work/`. The control and green runs use the same test script SHA256 and fixture SHA256; the packaged graph differs by design. The runs use a synthetic SDK and owned data, not an installed host or real system clipboard.

The original platform gate is still open. The v0.32 record says 105 Windows G0 cases and 15 Windows storage-foundation cases were NOT RUN; Windows 12 and later have separate gates that were also not run. macOS host/clipboard and target-application acceptance are not established by these portable fixtures.

## Historical root evidence ledger

Each hash below is SHA256 of the exact local root-evidence JSON named in the adjacent path. Only the v0.32 JSON was copied into this PR; all other listed paths remain local raw archive references.

### v0.10

- Original scope: isolated-named-pasteboard
- gateComplete: False
- Local root JSON SHA256: `1d73fd7580a042ea8117a38feab7b38765de5f253025a220815b3904905f8e90`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v010-root-evidence.json`

### v0.11

- Original scope: G0-isolated-prototype
- gateComplete: False
- Local root JSON SHA256: `9bb3447e414c445d8ce9f28adc089ceeea342d938f3ded693ffb6a1aabcc51c5`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v011-root-evidence.json`

### v0.12

- Original scope: G0-isolated-prototype
- gateComplete: False
- Local root JSON SHA256: `b73461920efa0c8c96a7a77437b4fe76cbe9bde6a3519dfe9bde0054e625574e`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v012-root-evidence.json`

### v0.13

- Original scope: isolated-g0-prototype
- gateComplete: False
- Local root JSON SHA256: `af6e355dadfe0d8e95f3aca5976a12eac226107eeda7bf5ba7d2984d6948feeb`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v013-root-evidence.json`

### v0.14

- Original scope: shared-in-memory-capture-content-policy-gate
- gateComplete: False
- Local root JSON SHA256: `ca9640f4c93c4be2fe842b0ce70075842addbc27fd9dccf8201243af1e66ea8e`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v014-root-evidence.json`

### v0.15

- Original scope: trusted-bundled-worker-text-url-scanning
- gateComplete: False
- Local root JSON SHA256: `8071049625b00b93b81722d193a57d219cf9fa1688bb78930625ae45bf1baa3c`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v015-root-evidence.json`

### v0.16

- Original scope: offline-html-worker-projection-and-shared-rtf-framing
- gateComplete: False
- Local root JSON SHA256: `af1f063bc4356bc94b0c50521d9b2c1f4860710defe2399b1eb46ee1f89a8600`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v016-root-evidence.json`

### v0.17

- Original scope: supervised-native-owned-bytes-to-v2-admission-fixture
- gateComplete: False
- Local root JSON SHA256: `530ffda264ad89e4571b06c0bf404639f2f5a2a38ac7c43d6fbb025b3ae98310`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v017-root-evidence.json`

### v0.18

- Original scope: supervised-native-codec-evidence-and-static-CF_HTML-worker
- gateComplete: False
- Local root JSON SHA256: `10d2ad2e9ab222ba4f50f9e2188c24f41d8794a2caa1c6bd85c0e8a00a8e2520`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v018-root-evidence.json`

### v0.19

- Original scope: bounded offline RTF text/link privacy projection with original native bytes preserved
- gateComplete: False
- Local root JSON SHA256: `47b5fb6a4849dbb105c5019abce8aa416b21cf956cfe9ce61ea39a552bee904c`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v019-root-evidence.json`

### v0.20

- Original scope: Node-only durable blob + LMDB journal component; full G0-G4 unchanged
- gateComplete: False
- Local root JSON SHA256: `109572f45b331c64b19f4b09cb387b1a4ccef54e4654421dae3bbdc2f8ca8e8f`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v020-root-evidence.json`

### v0.21

- Original scope: Node-only durable metadata consumer inbox in the same LMDB source journal; full G0-G4 unchanged
- gateComplete: False
- Local root JSON SHA256: `1a615d1ab855a523707dcd08a6dbefced1b17ceb4ce82560bcacebd1b0a8347e`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v021-root-evidence.json`

### v0.22

- Original scope: Node-only logical deletion/tombstone lifecycle in durable journal and consumer inbox; full G0-G4 unchanged
- gateComplete: False
- Local root JSON SHA256: `2578be8b39a56de73403047522775d27a512bf952794c73874c6c0ce8819ddfd`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v022-root-evidence.json`

### v0.23

- Original scope: Node-only journal schema3, durable outbox ACK proof, payload pins, and deleted-revision physical payload reclamation; full G0-G4 unchanged
- gateComplete: False
- Local root JSON SHA256: `3b2cca0bceb6c95fe11bc052eddba09688c6cb2d56349fde6ac8c3be59be6037`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v023-root-evidence.json`

### v0.24

- Original scope: bounded RTF Unicode scope, annotation privacy extraction and linear URI candidates; original full G0-G4 objective unchanged
- gateComplete: False
- Local root JSON SHA256: `3f14adc6171c068d121eae2f2c61759cbd5d04d40cbdf5b1ae1f53b60f43e501`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v024-root-evidence.json`

### v0.25

- Original scope: V1 native SDK write confirmation, safe migration backup retention and split preload wiring; full G0-G4 objective unchanged
- gateComplete: False
- Local root JSON SHA256: `0873da94b623f7c4b3859784fca030caffc71ddc49a7633818591a73b0d418f5`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v025-root-evidence.json`

### v0.26

- Original scope: V1 image admission and exact blob confirmation, safe retry/cursor and directory guard; full G0-G4 objective unchanged
- gateComplete: False
- Local root JSON SHA256: `e870eaec98bb1fe6fad7e17865caae4580edf133e7013aac486a49398f27a161`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v026-root-evidence.json`

### v0.27

- Original scope: Refresh the Windows G0 source-only kit and producer; unchanged full G0-G4 objective
- gateComplete: False
- Local root JSON SHA256: `c709816abba6847a4573b2e10909a8246f863aa68ea9d2965a465e4b76d552f6`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v027-root-evidence.json`

### v0.28

- Original scope: V1 known-image failure isolation and truthful process-test observation; full G0-G4 objective unchanged
- gateComplete: False
- Local root JSON SHA256: `56c01fc459e940b8fe710f70f6030ee533d864b0173ed7b3cd009328d33bbf9b`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v028-root-evidence.json`

### v0.29

- Original scope: Windows storage foundation source, native-only runner and strict protocol contracts; original G0-G4 unchanged
- gateComplete: False
- Local root JSON SHA256: `08115cadd6729ba2613e4e34cbd9d55c770f02356af61ed8678b7720e6704bf6`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v029-root-evidence.json`

### v0.30

- Original scope: V1 image retry rotation and primary-owner clear serialization; full original G0-G4 unchanged
- gateComplete: False
- Local root JSON SHA256: `83fb62022dbdc096f1d8feec859fe91b1aa21e5f9a11b11f078bb0ff2dcdb653`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v030-root-evidence.json`

### v0.31

- Original scope: source-grounded host/planner/portable design contracts and main-path completion audit; docs only
- gateComplete: False
- Local root JSON SHA256: `15ef150f27c48aea73fe9d6420f726cae2fa0d7006cfc3f7fef3ba240830cd14`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v031-root-evidence.json`

### v0.32

- Original scope: plugin-only V1 exact clear identity persistence and replay suppression
- gateComplete: False
- Local root JSON SHA256: `dcec9b26ef8b662d2a58188ba6c177248ac3cfe8d4740361dd8c9c6a7f10ec09`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v032-root-evidence.json`
- Root JSON copied with this PR: [validation/v032/v032-root-evidence.json](validation/v032/v032-root-evidence.json)

### v0.33

- Original scope: plugin-only V1 per-image retry journal/recovery, bounded owner scheduler, clear coordination and settings status; original full G0-G4 objective unchanged
- gateComplete: False
- Local root JSON SHA256: `7d4edc02a4c6c9aa4f76ea79a46b5a63fffc1d0778d6e6611df52d7dd929469a`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v033-root-evidence.json`
- Root JSON copied with implementation: [validation/v033/v033-root-evidence.json](validation/v033/v033-root-evidence.json)
- Final source: 797 entries, `60eda5be280b94accb62279ee3f9b22b753443a92226b69b4c2f7730e74a7b16`; Node24/Electron each1439 PASS/6 skips; Node20 focused113 PASS; actual development-package CJS each27/27; browser2/2.
- Implementation scope: [HISTORY_IMAGE_RETRY_JOURNAL.md](HISTORY_IMAGE_RETRY_JOURNAL.md)

### v0.34

- Original scope: documentation-only implementation ADR/design gate, pinned ten-file host source audit and pending independent A/B scope approvals; full G0–G4 objective unchanged
- goalStatus: active; goalComplete: False; gateComplete: False
- Local root JSON SHA256: `37494a37bc48e5035d9a1b0e2a9e123a117d97211319a10f8c87af37c9f60bae`
- Local-only source path: `artifacts/pasteboardpro/clipboard-format-g0/v034-root-evidence.json`
- Public root JSON: [validation/v034/v034-root-evidence.json](validation/v034/v034-root-evidence.json)
- Accepted design, not implemented: [IMPLEMENTATION_ADR.md](IMPLEMENTATION_ADR.md); separate pending permissions: [MAINLINE_SCOPE_APPROVAL.md](MAINLINE_SCOPE_APPROVAL.md)
- Source-only pinned audit: [validation/v034/host-source-audit.json](validation/v034/host-source-audit.json);10 archived originals/blob/excerpts; comparison raw/time and StorageManager factory gaps explicit
- Source797 entries/original selection and executable bits unchanged, digest `60eda5be280b94accb62279ee3f9b22b753443a92226b69b4c2f7730e74a7b16`; v0.33 root/results inherited, no tests/build/native rerun

### v0.35

- Scope: independent G3 crypto ADR/security design review and public primitive KATs only; original G0–G4 unchanged
- goalStatus: active; goalComplete: False; gateComplete: False; G3Complete: False
- Root JSON SHA256: `d6492065f1ad357bdd490bb6eeafd0459fc49cd1193d4447bfdec3b2ecdef203`
- Public root JSON: [validation/v035/v035-root-evidence.json](validation/v035/v035-root-evidence.json); local identical original: `artifacts/pasteboardpro/clipboard-format-g0/v035-root-evidence.json`
- [G3 crypto ADR](G3_CRYPTO_ADR.md): ACCEPTED DESIGN / NOT IMPLEMENTED; three reviewed text hashes/current metadata-bound ADR in root JSON
- Node24.15.0 / Node20.19.3 / Electron41.4.0 as Node, darwin/arm64 only: each24 standard primitive KATs +1 candidate KDF API/time observation; all exit0; raw scripts/sources/logs local-only, hash manifests and bounded summary public in root JSON
- No composed protocol vectors/runtime implementation/Windows/six-direction acceptance; no production KDF or hard-RSS claim; no implementation tests/build/native rerun
- Exact original source797 bytes/executable bits, original§1–11 and priorv034 root preserved; A/Bscope permissions pending, nohost/CIwrite, no stage/commit/push/publish

### v0.36

- Component-only: [pure wire](G3_WIRE_IMPLEMENTATION.md), [Node crypto](G3_CRYPTO_COMPONENT.md); actual affected-code review LIMITED APPROVE, later than frozen runtime-summary pending label.
- goalStatus: active; goalComplete: False; gateComplete: False; G3Complete: False
- Root SHA256: e0d656ddf15dcf6fd9824565c5f72a84b26cc76c37b80db388306e067579c850; [public capsule](validation/v036/v036-root-evidence.json), identical local original artifacts/pasteboardpro/clipboard-format-g0/v036-root-evidence.json
- Security-fixed source823 aggregate 76b856c8d175a02827c90846d1d6b9294d01c593589d1eba04167db22b90aaae; Node20/24/Electron each19 files/189 PASS, fail/skip/timeout0, sorted(path,count) sets equal; root tsc/workspace contract/Python oracle PASS.
- Nine-file fix explicitly approved/applied via original mechanism; prior two refusals and original4 RED to4 GREEN preserved. HostA/rootCIB remain PENDING.
- Canonical/copy source verification, original797 delta(+26,-0,only package.json two exports), original sections1-11, ADR and v033-v035 roots preserved. Full G0-G4/G3, host/durable adapters/activation/Windows/apps/six directions incomplete. Flags unchanged; no host/CI write or stage/commit/push/publish. Raw evidence local-only.

### v0.37

- [Verification budget finite implementation](G3_VERIFICATION_BUDGET.md); design snapshot remains historical NOTIMPLEMENTED/NOTRUN. Actual limited review approved, full G3/G0-G4 incomplete.
- Root SHA256: a9553f45388168f298c6bbd44f96dac09523d1cd52e8db9767001ff02bc2ceae; [public capsule](validation/v037/v037-root-evidence.json), identical local artifacts/pasteboardpro/clipboard-format-g0/v037-root-evidence.json.
- Final candidate003:845 source aggregate cbfee85bd51cf63d3b5e75a9ef5a3ba40cfc3ecc8cc17dd10257cd3c0d289329;11checks exit0/no timeout; Node20/24/Electron each73files568cases=562PASS6precise fixtureSKIP,14parent cases actually PASS.
- Manifest file bytes SHA38c07b96dc8641f2f96af053cb8b1fa405eff42461656c9408d6d932b8781157 differs from internal metadataDigest7abffc6e9aa585095f65c630c1a672de8ac70aa66b23fcc906e06ccd0c0cc8fb.
- Four log paths original state UNKNOWN and possible old log loss explicitly recorded;80 protected receipts unchanged does not prove all artifacts unchanged. No restore/cleanup.
- Original sections1-11/accepted crypto ADR/budget design snapshot and prior roots preserved; A/B pending, production flags off, no host/CI/Git publication. Raw receipts local-only; capsule hash-binds finite summary.

### v0.38

- [Startup budget / transaction / resource validation](G3_BUDGET_RESOURCE_VALIDATION.md); bounded source review LIMITED APPROVE, no remaining same-scope P1/P2. Full G0-G4/G3 incomplete.
- [Public root capsule](validation/v038/v038-root-evidence-002.json), identical local artifacts/pasteboardpro/clipboard-format-g0/v038-root-evidence-002.json; SHA256 b7a25ad85aee573760882c77b2804190f276e3cdf2d5bb63d3456c28726b31df. Predecessor capsule remains byte-for-byte available. Raw test/process/source records are local-only.
- Current 860-source aggregate 3595a5e874516b67c3327276f9fa372f777ec84954c572952db6717317db92a2; vs845: 15 new, 3 changed, 0 removed. Source and copy match. Root types/contract/build/public imports/strict NodeNext and three runtime suites: 11 checks exit0/no timeout.
- Node24/20/Electron-as-Node each 15 files, 73 cases = 71 PASS / 0 FAIL / 2 exact child-only fixture SKIP, actual parent cases pass; same file/case/status sets. This is budget regression, not product-wide or Windows acceptance.
- Resource 10 unique cases are separate evidence. Epoch4096 seed does not prove max128-step trusted history; private seams/math-only512MiB/2^32 and cooperative native/RSS limits remain explicit. Both cache-isolation UNKNOWN and historical four-log UNKNOWN incidents retained.
- Original sections1-11, both frozen ADRs, v033-v037 dual roots and80 protected receipts match; A/B pending, flags off, no host/CI/Git publication.

### v0.39

- [Portable Unicode codec / projection candidate](PORTABLE_TEXT_PROJECTION.md): bounded plugin component only; no production paste/sync activation or full P1/G2/G3/G0-G4 completion.
- [Public root capsule](validation/v039/v039-root-evidence.json), identical local artifacts/pasteboardpro/clipboard-format-g0/v039-root-evidence.json; SHA256 a33b61567fae2ebbdabb6d13eb0dc4a10058c665d93dee01ec412f542ef5e72d. Raw reports, command logs and source records remain local-only.
- 867-source aggregate 7bde45c013afe7af4a3ea6e01c27c6b1d102ea62c79b0ea23bb5e5441d5fca96; vs860: 7 added, only v2.ts two exports changed, 0 removed. Both candidate/current source and dependency fingerprints match; prior80 receipts, v038 roots, frozen ADRs and original sections1-11 preserved.
- Nine named commands exit0/no timeout/reaped: root project types, contract, strict public NodeNext and version/suite per Node24/20/Electron-as-Node. Each runtime4files/87PASS/0FAIL/0skip (68new+19wire), same file/case/status sets; independent Sol LIMITED APPROVE is limited to these component gates.
- Both outer runners exited1: candidate001 order-only selection assertion after five successful commands; candidate002 persisted summary before json.dumps(flush=True) print failure after remaining four. Original failure receipts/runners remain; this is not whole-pipeline PASS.
- Effective6+2 RED→GREEN and fixture-only failures stay distinct; generic metadata bounds are not legal store E2E. Historical four-log/shared-cache UNKNOWN incidents retained. A/B pending, flags off, Windows/host/six directions/full gates incomplete, no Git publication.

## local-raw-artifact-archive

For a link whose exact file was not copied, the original label is retained and its destination points here or to the matching phase row above. The original target remains in the generated local audit map at `artifacts/pasteboardpro/pr-preparation/doc-audit/doc-link-map.json`; that audit output is ignored and does not ship with the PR.

The mapped phase indicates where the historical local record belonged. It is not a substitute for the missing raw file and does not upgrade the record into current release evidence.

## Scope documents

- [Technical plan](TECHNICAL_PLAN.md)
- [Acceptance gates](ACCEPTANCE.md)
- [Implementation status](IMPLEMENTATION_STATUS.md)
- [Review](REVIEW.md)
- [History clear boundary](HISTORY_CLEAR_BOUNDARY.md)
