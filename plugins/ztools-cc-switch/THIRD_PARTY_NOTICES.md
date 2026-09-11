# Third-Party Notices

AI Provider Switch is an independent ZTools implementation. It does not embed
the cc-switch desktop application or Gemini CLI runtime. The following public
projects informed compatible behavior or supplied public protocol constants.

## cc-switch

- Project: https://github.com/farion1231/cc-switch
- Related source: https://github.com/farion1231/cc-switch/blob/98230c3970f4769a2a631d5119d371db6e17e534/src-tauri/src/services/subscription.rs
- License: MIT
- Copyright: Copyright (c) 2025 Jason Young
- Use: configuration semantics, supported-client behavior and interaction
  concepts used as compatibility references.

The MIT license for cc-switch is available at:
https://github.com/farion1231/cc-switch/blob/878c26f31e012ba32b9772bd080bd4fa9e7d495e/LICENSE

## Gemini CLI

- Project: https://github.com/google-gemini/gemini-cli
- Source: https://github.com/google-gemini/gemini-cli/blob/69b51f8fa2af0abf717daaba4dca1c627023d82d/packages/core/src/code_assist/oauth2.ts
- License: Apache License 2.0
- Use: public installed-app OAuth Client ID/Secret and compatible refresh
  behavior used only to query quota for an existing local Gemini CLI session.

The Apache License 2.0 text is available at:
https://github.com/google-gemini/gemini-cli/blob/69b51f8fa2af0abf717daaba4dca1c627023d82d/LICENSE

Third-party names and trademarks belong to their respective owners. No
affiliation or endorsement is implied.
