//! # Streamcable
//!
//! A binary serialization format for objects optimized for streaming.
//!
//! This Rust implementation provides serialization and deserialization capabilities
//! compatible with the TypeScript Streamcable library.
//!
//! ## Example
//!
//! ```rust
//! use streamcable::{Schema, serialize, deserialize};
//!
//! // Define a schema
//! let schema = Schema::object(vec![
//!     ("name".to_string(), Schema::string()),
//!     ("age".to_string(), Schema::uint()),
//! ]);
//! ```

mod data_types;
mod error;
mod rolling_uint;
mod schema;
mod serialize;
mod deserialize;
mod read_context;
mod stream_multiplexer;

pub use data_types::DataType;
pub use error::{StreamcableError, ValidationError};
pub use schema::{Schema, Value, ValueStream, ByteStream};
pub use serialize::serialize;
pub use deserialize::deserialize;
pub use stream_multiplexer::{StreamMultiplexer, StreamWriter, serialize_promise, serialize_iterator, serialize_byte_stream};

#[cfg(test)]
mod tests {
    #[test]
    fn basic_test() {
        // Basic sanity check that the module compiles
        assert_eq!(2 + 2, 4);
    }
}
