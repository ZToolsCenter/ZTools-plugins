# Legacy journal fixture (v0.22)

These files preserve the local runtime dependency graph for the v0.22 journal used by `outbox-acknowledgements.test.ts`. The original test imported the ignored v0.22 source capsule under `artifacts/`; a fresh checkout cannot contain that capsule, so the test now loads this tracked copy.

Source: `artifacts/pasteboardpro/clipboard-format-g0/v023-inputs/source-v022/packages/snapshot-store/src/` from the local v0.22 source snapshot. The root journal SHA-256 is `cd3391731528d742650b5c640bf30f4f7f7aebe60dfc21db38aca4dda4cda8b6`. All copied files are byte-for-byte source copies; only workspace package imports (`lmdb`, `zod`, `@pasteboard-pro/core`) resolve to declared project dependencies.

## Included source files

| File | Lines | SHA-256 |
| --- | ---: | --- |
| `src/consumer-inbox.ts` | 87 | `2d57b83098722e072d7afd8002b3133495156e03cb82f193f79a33fd6403246e` |
| `src/consumer-leases.ts` | 322 | `de87c79c83aee42ace1e33e3b18b7ad2be018839e6402b0666829bec67540c7f` |
| `src/consumer-records.ts` | 185 | `26a621aa3a547d8f0dc49cbaaff0b58a8c373f3743b92ae01489e6a389bec196` |
| `src/consumer-roots.ts` | 153 | `184f949ebf6ba902954f58223be7f944d59fb808217058f8285319245c4a98ca` |
| `src/consumer-staging.ts` | 325 | `8fe8df8c2d05f291e3a19796988c160a9b191285d6576dd27aec9f0c2397220a` |
| `src/consumer-types.ts` | 83 | `a3e516eb8dbcb514b5557b2473296ef88ff8562ac6fbed6839de29b5de07f27b` |
| `src/consumer-validation.ts` | 249 | `7120a0d8e3b84693f84e9c73210ed119b27352b3a9d611e35ca50a60d951a742` |
| `src/deletion-records.ts` | 167 | `a8b2e45e17b2b66eb02f334d0074aa420b21d2efff536ce93d7c50cd83d1a7e7` |
| `src/deletion-write.ts` | 244 | `232bb69cef9d1095d7102c7ae39d091b0cbf9a460155bf754a8b41b6f5d243e2` |
| `src/errors.ts` | 12 | `5d6361a7fa07f8549e529bfc14d249938d62cbb79fa64188ea6a8c2a77f53e16` |
| `src/fs-directory.ts` | 50 | `5d5ad20dabf4badfde800dc83128ffdaece21411afbaa2d8611819a0424d8bac` |
| `src/journal-files.ts` | 376 | `120dc076d061d3dc55245ccb028cc1cd973e5c47c9e5a053f7e3b31fe28efdd5` |
| `src/journal-read.ts` | 224 | `11551f46f3b4bb144e8b57c6b541304ae13e70ccc15340abd1680127dc161ba0` |
| `src/journal-records.ts` | 402 | `2e599898827696b08bfa27a8eda452424ac8fd41164a8b103cb3f7fb9a1cb47d` |
| `src/journal-roots.ts` | 377 | `3c474dcb7a954bd0b4e57857a977c87fcc86fb72eb4ff5a3841756ba52b1632a` |
| `src/journal-validation.ts` | 318 | `be8da9b14d95b86180b29298323ab808711cb2d33cbfbdd5c4c9f155a1035917` |
| `src/journal-write.ts` | 425 | `1256aa10f68bbd4c0034a321de2b288ece3fefac54a43e69dd297f56ecda7700` |
| `src/journal.ts` | 225 | `cd3391731528d742650b5c640bf30f4f7f7aebe60dfc21db38aca4dda4cda8b6` |
| `src/types.ts` | 48 | `2cc97ce9af2b927c86931e83c91168bc7bfde8595538e7f31e71f73c8af085ee` |
