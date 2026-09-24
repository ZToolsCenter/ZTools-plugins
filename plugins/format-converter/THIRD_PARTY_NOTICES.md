# Third-party notices

- OfficeCLI — Apache-2.0. The plugin discovers or installs the official binary on demand; it is not bundled in the plugin package.
- React, React DOM — MIT.
- Lucide — ISC.
- pdf-lib — MIT. Installed on demand after user confirmation.
- PDF.js / pdfjs-dist — Apache-2.0. Installed on demand after user confirmation.
- sharp — Apache-2.0; its libvips runtime and transitive codecs retain their respective licenses. Installed on demand for the current platform.
- @napi-rs/canvas — MIT. Development and Node integration-test dependency only; not included in the marketplace package.
- Tesseract.js — Apache-2.0. Runtime and the `eng` / `chi_sim` language packages are installed from the npm mirror only after user confirmation.
- ExcelJS — MIT. Installed on demand after user confirmation.
- iconv-lite — MIT.

Optional system-installed Chrome, Edge, Chromium and LibreOffice are invoked as separate programs and are not redistributed by this plugin.

On-demand npm packages are version-pinned by `preload/runtime-manifest.json`, verified against their lockfile SRI digest, and retain the license files contained in their original npm tarballs.
