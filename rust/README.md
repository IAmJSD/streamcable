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

## Limitations

This implementation currently does not support:
- `Promise` types (async values)
- `Iterator` types (streaming values)
- `ReadableStream` types

These may be added in future versions.

## Compatibility

This Rust implementation is compatible with the TypeScript Streamcable library at version 0.0.2. Data serialized by either implementation can be deserialized by the other.

## License

MIT
