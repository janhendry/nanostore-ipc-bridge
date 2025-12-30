# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-alpha.1] - 2025-12-30

### Added

- Initial alpha release
- `syncedAtom()` for zero-config state synchronization across Electron processes
- Multi-window synchronization with automatic registration
- Monotonic revision tracking to prevent race conditions
- `defineService()` for type-safe RPC with events
- Full TypeScript support with type inference
- Separate entry points for main, preload, and universal contexts
- Comprehensive documentation and examples
- Test application demonstrating all features

### Features

- Zero-config setup - import stores once, works everywhere
- Race-condition free synchronization
- Support for multiple renderer windows
- Type-safe services with event broadcasting
- Developer-friendly API with no manual registration

[0.1.0-alpha.1]: https://github.com/janhendry/nanostore-ipc-bridge/releases/tag/v0.1.0-alpha.1
