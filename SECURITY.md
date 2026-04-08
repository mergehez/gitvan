# Security Policy

## Scope

Gitvan is a desktop Git client that can store account metadata, interact with OAuth device flow, and use locally stored secrets through the operating system keychain.

Security reports are especially valuable for issues involving:

- token handling
- OAuth device flow
- keychain or local secret storage
- repository path handling
- command execution or shell injection
- unsafe file access

## Reporting

If you discover a security issue, please do not open a public issue with exploit details.

Instead, contact the maintainer privately and include:

- a clear description of the issue
- affected versions or commit range if known
- reproduction steps or a proof of concept
- impact assessment
- any suggested remediation if you have one

If a dedicated security contact address is added later, this file should be updated to use it.

## Handling Goals

The intended process is:

1. Confirm the report and reproduce the issue.
2. Assess severity and affected versions.
3. Prepare and validate a fix.
4. Publish the fix and disclose the issue once users can update.

## Secrets And Test Data

Please avoid sending real tokens, real customer repositories, or personal credentials in reports. Redacted examples are preferred.
