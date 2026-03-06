# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 0.1.x | Yes |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

**Do not open a public issue.**

Instead, email [vladtemian@gmail.com](mailto:vladtemian@gmail.com) with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You should receive a response within 48 hours. We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Scope

This package reads local transcript files from the filesystem. Security concerns include:

- Path traversal in transcript discovery
- Parsing untrusted JSONL content
- Information leakage through error messages
