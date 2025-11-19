# Streamcable - Rust Implementation

A binary serialization format for objects optimized for streaming.

This Rust implementation provides serialization and deserialization capabilities compatible with the TypeScript Streamcable library.

## Features

- ✅ Efficient binary serialization with variable-length encoding
- ✅ Support for basic types: boolean, integers, floats, strings, bytes
- ✅ Support for complex types: arrays, objects, maps
- ✅ Support for nullable and optional values
- ✅ Support for union types
- ✅ Async I/O using Tokio
- ✅ Compatible with TypeScript implementation

## Installation

Add this to your `Cargo.toml`:

```toml
[dependencies]
streamcable = { path = "../rust" }
tokio = { version = "1", features = ["full"] }
```

## Usage

### Basic Example

```rust
use streamcable::{Schema, Value, serialize, deserialize};
use std::collections::HashMap;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Create a schema
    let schema = Schema::object(vec![
        ("name".to_string(), Schema::string()),
        ("age".to_string(), Schema::uint()),
        ("active".to_string(), Schema::boolean()),
    ]);
    
    // Create a value
    let mut obj = HashMap::new();
    obj.insert("name".to_string(), Value::String("Alice".to_string()));
    obj.insert("age".to_string(), Value::Uint(30));
    obj.insert("active".to_string(), Value::Boolean(true));
    let value = Value::Object(obj);
    
    // Serialize
    let mut buffer = Vec::new();
    serialize(&schema, &value, &mut buffer, true).await?;
    
    println!("Serialized {} bytes", buffer.len());
    
    // Deserialize
    let (received_schema, received_value) = deserialize(&buffer[..], None).await?;
    
    println!("Deserialized: {:?}", received_value);
    
    Ok(())
}
```

### Working with Arrays

```rust
use streamcable::{Schema, Value};

let schema = Schema::array(Schema::uint());

let value = Value::Array(vec![
    Value::Uint(1),
    Value::Uint(2),
    Value::Uint(3),
]);
```

### Working with Maps

```rust
use streamcable::{Schema, Value};

let schema = Schema::map(Schema::string(), Schema::uint());

let value = Value::Map(vec![
    (Value::String("a".to_string()), Value::Uint(1)),
    (Value::String("b".to_string()), Value::Uint(2)),
]);
```

### Union Types

```rust
use streamcable::{Schema, Value};

let schema = Schema::union(vec![
    Schema::string(),
    Schema::uint(),
    Schema::boolean(),
]);

// Can accept any of the union types
let value1 = Value::String("hello".to_string());
let value2 = Value::Uint(42);
let value3 = Value::Boolean(true);
```

### Optional and Nullable

```rust
use streamcable::{Schema, Value};

// Optional - can be undefined (represented as Null in Rust)
let schema_optional = Schema::optional(Schema::string());

// Nullable - can be null
let schema_nullable = Schema::nullable(Some(Schema::string()));

// Both accept Null
let value = Value::Null;
```

### Streaming Types with Tokio

**Note**: These types are supported for schema definition and validation, but full serialization/deserialization with stream multiplexing is planned for a future release.

```rust
use streamcable::{Schema, Value};
use tokio::sync::oneshot;
use async_stream::stream;

// Promise - async value using Tokio oneshot channel
let promise_schema = Schema::promise(Schema::string());
let (tx, rx) = oneshot::channel();
let promise_value = Value::Promise(rx);

// Iterator/Stream - async stream of values
let iterator_schema = Schema::iterator(Schema::uint());
let value_stream = stream! {
    for i in 0..5 {
        yield Ok(Value::Uint(i));
    }
};
let stream_value = Value::Stream(Box::pin(value_stream));

// ReadableStream - byte stream
let readable_schema = Schema::readable_stream();
let byte_stream = stream! {
    yield Ok(bytes::Bytes::from("data"));
};
let byte_stream_value = Value::ByteStream(Box::pin(byte_stream));
```

## Supported Types

### Basic Types
- `boolean()` - Boolean values
- `uint8()` - 8-bit unsigned integers (0-255)
- `uint()` - Variable-length unsigned integers
- `int()` - Variable-length signed integers with zigzag encoding
- `float()` - 64-bit floating-point numbers
- `bigint()` - 64-bit unsigned integers
- `string()` - UTF-8 encoded strings
- `bytes()` - Byte arrays
- `date()` - ISO date strings

### Complex Types
- `array(Schema)` - Arrays of elements
- `object(Vec<(String, Schema)>)` - Objects with defined fields
- `map(KeySchema, ValueSchema)` - Maps with arbitrary keys
- `record(ValueSchema)` - Objects with dynamic keys

### Special Types
- `nullable(Option<Schema>)` - Nullable values
- `optional(Schema)` - Optional values
- `union(Vec<Schema>)` - Union of multiple types

### Streaming Types (Tokio Primitives)
- `promise(Schema)` - Promise/Future types using `tokio::sync::oneshot::Receiver`
- `iterator(Schema)` - Async iterator/stream types using `Stream<Item = Result<Value, _>>`
- `readable_stream()` - Byte stream types using `Stream<Item = Result<Bytes, _>>`

**Stream Multiplexing**: Use `StreamMultiplexer` to serialize streaming types:
```rust
use streamcable::{StreamMultiplexer, serialize_promise};

let (multiplexer, rx) = StreamMultiplexer::new();
let stream_id = serialize_promise(&multiplexer, promise, &schema).await?;
// Messages are sent through the rx channel
```

See `examples/multiplexing.rs` for complete usage.

## Implementation Status

### Fully Supported ✅
All basic, complex, and special types are fully implemented with complete serialization/deserialization support.

### Streaming Types ✅ (Partial)
Streaming types (Promise, Iterator, ReadableStream) are supported for:
- Schema definition and validation ✅
- Schema serialization (wire format compatible) ✅
- Type checking and composition ✅
- **Stream multiplexing infrastructure** ✅ (NEW!)
  - `StreamMultiplexer` for managing concurrent streams
  - `serialize_promise()`, `serialize_iterator()`, `serialize_byte_stream()` functions
  - Message routing and stream lifecycle management

**In Progress**:
- Integration with main `serialize()` function
- Full deserialization with stream demultiplexing
- Advanced APIs: `serialize_with_streams()`, `deserialize_with_streams()`

See `examples/multiplexing.rs` for stream multiplexing usage.

## Compatibility

This Rust implementation is compatible with the TypeScript Streamcable library at version 0.0.2 for all non-streaming types. Streaming types follow the same wire format specification.

## License

MIT
