# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in goose-note, **please do not open a
public issue**. Instead, report it privately:

- Use GitHub's [private vulnerability reporting](https://github.com/eachann1024/goose-notes/security/advisories/new)
  (Security → Advisories → Report a vulnerability), or
- Open a minimal issue asking for a private contact channel without disclosing details.

Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce
- Any relevant environment details (OS, uTools version or browser)

We will acknowledge your report as soon as possible and keep you informed about
the fix. Please give us reasonable time to address the issue before any public
disclosure.

## Scope

goose-note is a local-first note-taking app. Of particular interest:

- Issues that could expose or corrupt local notebook data
- Issues in the local-folder mounting / file-system access paths
- Injection or sandbox-escape issues in the editor or AI integration
