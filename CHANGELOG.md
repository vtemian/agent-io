# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.2] - 2026-03-06

### Fixed

- `stop()` now clears all subscriptions and resets observer state — no need to manually track dispose functions

## [0.1.1] - 2026-03-06

### Changed

- Release workflow aligned with tag-based publishing (`v*` tags)
- npm trusted publisher (OIDC) for provenance attestation

## [0.1.0] - 2026-03-06

### Added

- Provider-agnostic `createObserver` API with lifecycle diffing
- Built-in Cursor transcript provider (`createCursorTranscriptProvider`)
- Watch runtime with debounced refresh, concurrency guards, and exponential backoff
- Canonical agent model (`CanonicalAgentSnapshot`, `CanonicalAgentStatus`)
- `TranscriptProvider` interface for custom providers
- Zod-based transcript validation
- Three public entry points: `.`, `./core`, `./providers/cursor`
- ESM and CJS dual builds via tsup
- Full test suite (59 tests)
- CI pipeline (Biome + TypeScript + Vitest)
- Tag-based release workflow with npm provenance

[0.1.2]: https://github.com/vtemian/agentprobe/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/vtemian/agentprobe/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/vtemian/agentprobe/releases/tag/v0.1.0
