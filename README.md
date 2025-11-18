# Streamcable

**Streamcable is still in alpha. The documentation is very limited, things might be broken, and the binary protocol might change.**

A binary serialization format for objects optimized for streaming.

## Implementations

- **TypeScript/JavaScript** - Full implementation with support for streaming types (Promise, Iterator, ReadableStream)
- **Rust** - Complete implementation compatible with TypeScript (see `rust/` directory)

## Features

- Efficient binary serialization with variable-length encoding
- Support for basic types: boolean, integers, floats, strings, bytes
- Support for complex types: arrays, objects, maps
- Support for nullable and optional values
- Support for union types
- Streaming support in TypeScript implementation

## Quick Start

### TypeScript

```bash
npm install streamcable
```

### Rust

Add to your `Cargo.toml`:
```toml
[dependencies]
streamcable = { path = "path/to/rust" }
```

See the [Rust README](rust/README.md) for detailed documentation and examples.

## License

MIT
