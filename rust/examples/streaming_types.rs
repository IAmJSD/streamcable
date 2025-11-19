//! Example demonstrating Promise, Iterator/Stream, and ReadableStream types
//! 
//! These types use Tokio primitives and async streams.

use streamcable::{Schema, Value};
use tokio::sync::oneshot;
use async_stream::stream;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== Streamcable Streaming Types Example ===\n");

    // Example 1: Promise type
    println!("Example 1: Promise");
    {
        let schema = Schema::promise(Schema::string());
        
        // Create a oneshot channel for the promise
        let (tx, rx) = oneshot::channel();
        
        // Spawn a task that will resolve the promise later
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            let _ = tx.send(Box::new(Value::String("Resolved value!".to_string())));
        });
        
        let value = Value::Promise(rx);
        
        // Validate the schema
        match schema.validate(&value) {
            Ok(_) => println!("  ✓ Promise value validates successfully"),
            Err(e) => println!("  ✗ Validation error: {}", e),
        }
        
        println!("  Note: Full serialization requires stream multiplexing\n");
    }

    // Example 2: Iterator/Stream type
    println!("Example 2: Iterator/Stream");
    {
        let schema = Schema::iterator(Schema::uint());
        
        // Create an async stream of numbers
        let number_stream = stream! {
            for i in 0..5 {
                tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                yield Ok(Value::Uint(i));
            }
        };
        
        let value = Value::Stream(Box::pin(number_stream));
        
        // Validate the schema
        match schema.validate(&value) {
            Ok(_) => println!("  ✓ Stream value validates successfully"),
            Err(e) => println!("  ✗ Validation error: {}", e),
        }
        
        println!("  Note: Full serialization requires stream multiplexing\n");
    }

    // Example 3: ReadableStream (byte stream)
    println!("Example 3: ReadableStream");
    {
        let schema = Schema::readable_stream();
        
        // Create a byte stream
        let byte_stream = stream! {
            let chunks = vec![
                bytes::Bytes::from("Hello, "),
                bytes::Bytes::from("streaming "),
                bytes::Bytes::from("world!"),
            ];
            
            for chunk in chunks {
                tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                yield Ok(chunk);
            }
        };
        
        let value = Value::ByteStream(Box::pin(byte_stream));
        
        // Validate the schema
        match schema.validate(&value) {
            Ok(_) => println!("  ✓ ByteStream value validates successfully"),
            Err(e) => println!("  ✗ Validation error: {}", e),
        }
        
        println!("  Note: Full serialization requires stream multiplexing\n");
    }

    // Example 4: Schema serialization
    println!("Example 4: Schema serialization");
    {
        let promise_schema = Schema::promise(Schema::string());
        let iterator_schema = Schema::iterator(Schema::uint());
        let stream_schema = Schema::readable_stream();
        
        println!("  Promise schema bytes: {:?}", promise_schema.to_bytes());
        println!("  Iterator schema bytes: {:?}", iterator_schema.to_bytes());
        println!("  ReadableStream schema bytes: {:?}", stream_schema.to_bytes());
        println!();
    }

    // Example 5: Complex nested with Promise
    println!("Example 5: Complex object with Promise field");
    {
        let _schema = Schema::object(vec![
            ("id".to_string(), Schema::uint()),
            ("name".to_string(), Schema::string()),
            ("async_data".to_string(), Schema::promise(Schema::array(Schema::string()))),
        ]);
        
        println!("  ✓ Created schema with Promise field");
        println!("  Schema can be used for validation and type checking");
        println!("  Full serialization/deserialization requires stream handler\n");
    }

    println!("=== Notes ===");
    println!("These streaming types are now supported in the schema system!");
    println!("- Promise: Uses tokio::sync::oneshot::Receiver");
    println!("- Iterator/Stream: Uses pinned boxed Stream<Item = Result<Value, _>>");
    println!("- ReadableStream: Uses pinned boxed Stream<Item = Result<Bytes, _>>");
    println!();
    println!("Full serialization/deserialization with stream multiplexing");
    println!("will be implemented in a future update with advanced APIs.");

    Ok(())
}
