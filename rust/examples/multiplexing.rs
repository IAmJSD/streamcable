//! Example demonstrating stream multiplexing for Promise, Iterator, and ReadableStream
//! 
//! This shows the advanced serialization with full stream multiplexing support.

use streamcable::{Schema, Value, StreamMultiplexer, serialize_promise, serialize_iterator, serialize_byte_stream};
use tokio::sync::oneshot;
use async_stream::stream;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== Stream Multiplexing Example ===\n");

    // Example 1: Stream Multiplexer basics
    println!("Example 1: Creating a Stream Multiplexer");
    {
        let (multiplexer, mut rx) = StreamMultiplexer::new();
        
        println!("  ✓ Created multiplexer");
        println!("  Active streams: {}", multiplexer.active_count().await);
        
        // Create a stream
        let (id, writer) = multiplexer.create_stream().await?;
        println!("  Created stream with ID: {}", id);
        println!("  Active streams: {}", multiplexer.active_count().await);
        
        // Write some data
        writer.write(vec![1, 2, 3, 4, 5])?;
        writer.close()?;
        
        // Check for messages
        if let Some(msg) = rx.recv().await {
            println!("  Received message: {:?}", msg);
        }
        if let Some(msg) = rx.recv().await {
            println!("  Received message: {:?}", msg);
        }
        
        multiplexer.close_stream(id).await;
        println!("  Active streams after close: {}\n", multiplexer.active_count().await);
    }

    // Example 2: Multiple concurrent streams
    println!("Example 2: Multiple Concurrent Streams");
    {
        let (multiplexer, mut rx) = StreamMultiplexer::new();
        
        // Create multiple streams
        let (id1, writer1) = multiplexer.create_stream().await?;
        let (id2, writer2) = multiplexer.create_stream().await?;
        let (id3, writer3) = multiplexer.create_stream().await?;
        
        println!("  Created 3 streams: {}, {}, {}", id1, id2, id3);
        println!("  Active streams: {}", multiplexer.active_count().await);
        
        // Write to different streams
        writer1.write(b"Stream 1 data".to_vec())?;
        writer2.write(b"Stream 2 data".to_vec())?;
        writer3.write(b"Stream 3 data".to_vec())?;
        
        // Close all streams
        writer1.close()?;
        writer2.close()?;
        writer3.close()?;
        
        // Collect messages
        let mut msg_count = 0;
        while let Ok(msg) = tokio::time::timeout(
            tokio::time::Duration::from_millis(100),
            rx.recv()
        ).await {
            if msg.is_some() {
                msg_count += 1;
            } else {
                break;
            }
        }
        
        println!("  Received {} messages", msg_count);
        
        multiplexer.close_stream(id1).await;
        multiplexer.close_stream(id2).await;
        multiplexer.close_stream(id3).await;
        println!("  Active streams after close: {}\n", multiplexer.active_count().await);
    }

    // Example 3: Serializing a Promise with multiplexer
    println!("Example 3: Serializing a Promise");
    {
        let (multiplexer, mut rx) = StreamMultiplexer::new();
        let schema = Schema::promise(Schema::string());
        
        // Create a promise
        let (tx, rx_promise) = oneshot::channel();
        
        // Spawn task to resolve promise
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            let _ = tx.send(Box::new(Value::String("Resolved!".to_string())));
        });
        
        // Serialize the promise
        let stream_id = serialize_promise(&multiplexer, rx_promise, &Schema::string()).await?;
        println!("  Promise serialized to stream ID: {}", stream_id);
        
        // Wait for promise resolution
        tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;
        
        // Check for messages
        let mut msg_count = 0;
        while let Ok(msg) = tokio::time::timeout(
            tokio::time::Duration::from_millis(50),
            rx.recv()
        ).await {
            if msg.is_some() {
                msg_count += 1;
            } else {
                break;
            }
        }
        
        println!("  Received {} messages from promise stream\n", msg_count);
    }

    // Example 4: Serializing an Iterator
    println!("Example 4: Serializing an Iterator");
    {
        let (multiplexer, mut rx) = StreamMultiplexer::new();
        
        // Create an iterator stream
        let value_stream = stream! {
            for i in 0..5 {
                tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                yield Ok(Value::Uint(i));
            }
        };
        
        let stream_id = serialize_iterator(&multiplexer, Box::pin(value_stream)).await?;
        println!("  Iterator serialized to stream ID: {}", stream_id);
        
        // Wait for iteration to complete
        tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
        
        // Check for messages
        let mut msg_count = 0;
        while let Ok(msg) = tokio::time::timeout(
            tokio::time::Duration::from_millis(50),
            rx.recv()
        ).await {
            if msg.is_some() {
                msg_count += 1;
            } else {
                break;
            }
        }
        
        println!("  Received {} messages from iterator stream\n", msg_count);
    }

    // Example 5: Serializing a Byte Stream
    println!("Example 5: Serializing a ByteStream");
    {
        let (multiplexer, mut rx) = StreamMultiplexer::new();
        
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
        
        let stream_id = serialize_byte_stream(&multiplexer, Box::pin(byte_stream)).await?;
        println!("  ByteStream serialized to stream ID: {}", stream_id);
        
        // Wait for streaming to complete
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
        
        // Check for messages
        let mut msg_count = 0;
        while let Ok(msg) = tokio::time::timeout(
            tokio::time::Duration::from_millis(50),
            rx.recv()
        ).await {
            if msg.is_some() {
                msg_count += 1;
            } else {
                break;
            }
        }
        
        println!("  Received {} messages from byte stream\n", msg_count);
    }

    println!("=== Summary ===");
    println!("Stream multiplexing is now fully implemented!");
    println!("- StreamMultiplexer manages concurrent streams");
    println!("- Each stream gets a unique ID (u16)");
    println!("- Messages are tagged with stream ID");
    println!("- Multiple streams can be active simultaneously");
    println!("- Proper cleanup when streams close");

    Ok(())
}
