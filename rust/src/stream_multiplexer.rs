//! Stream multiplexing for handling concurrent streams over a single connection
//!
//! This module provides the infrastructure for serializing and deserializing streaming
//! types (Promise, Iterator, ReadableStream) by multiplexing multiple concurrent streams
//! over a single connection.

use crate::error::StreamcableError;
use crate::rolling_uint::{get_rolling_uint_size, write_rolling_uint_no_alloc};
use crate::schema::{ByteStream, Value, ValueStream};
use futures::StreamExt;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncWrite, AsyncWriteExt};
use tokio::sync::{mpsc, Mutex};

/// Maximum number of concurrent streams
const MAX_CONCURRENT_STREAMS: usize = 65535;

/// Stream identifier type
pub type StreamId = u16;

/// Message sent through a multiplexed stream
#[derive(Debug, Clone)]
pub enum StreamMessage {
    /// Data chunk for a stream
    Data(StreamId, Vec<u8>),
    /// Stream completed successfully
    Close(StreamId),
    /// Stream error
    Error(StreamId, String),
}

/// Writer handle for a multiplexed stream
pub struct StreamWriter {
    id: StreamId,
    tx: mpsc::UnboundedSender<StreamMessage>,
}

impl StreamWriter {
    /// Write data to the stream
    pub fn write(&self, data: Vec<u8>) -> Result<(), StreamcableError> {
        self.tx
            .send(StreamMessage::Data(self.id, data))
            .map_err(|_| StreamcableError::InvalidData("Stream channel closed".to_string()))
    }

    /// Close the stream
    pub fn close(&self) -> Result<(), StreamcableError> {
        self.tx
            .send(StreamMessage::Close(self.id))
            .map_err(|_| StreamcableError::InvalidData("Stream channel closed".to_string()))
    }

    /// Send an error on the stream
    pub fn error(&self, message: String) -> Result<(), StreamcableError> {
        self.tx
            .send(StreamMessage::Error(self.id, message))
            .map_err(|_| StreamcableError::InvalidData("Stream channel closed".to_string()))
    }
}

/// Context for multiplexing streams during serialization
pub struct StreamMultiplexer {
    next_id: Arc<Mutex<StreamId>>,
    tx: mpsc::UnboundedSender<StreamMessage>,
    active_streams: Arc<Mutex<HashMap<StreamId, bool>>>,
}

impl StreamMultiplexer {
    /// Create a new stream multiplexer
    pub fn new() -> (Self, mpsc::UnboundedReceiver<StreamMessage>) {
        let (tx, rx) = mpsc::unbounded_channel();
        
        Self {
            next_id: Arc::new(Mutex::new(1)),
            tx,
            active_streams: Arc::new(Mutex::new(HashMap::new())),
        }.into_pair(rx)
    }

    fn into_pair(self, rx: mpsc::UnboundedReceiver<StreamMessage>) -> (Self, mpsc::UnboundedReceiver<StreamMessage>) {
        (self, rx)
    }

    /// Create a new stream and return its ID and writer
    pub async fn create_stream(&self) -> Result<(StreamId, StreamWriter), StreamcableError> {
        let mut next_id = self.next_id.lock().await;
        let id = *next_id;
        
        if id == 0 || id >= MAX_CONCURRENT_STREAMS as u16 {
            return Err(StreamcableError::InvalidData(
                "Maximum concurrent streams exceeded".to_string(),
            ));
        }
        
        *next_id = next_id.wrapping_add(1);
        if *next_id == 0 {
            *next_id = 1;
        }
        
        let mut active = self.active_streams.lock().await;
        active.insert(id, true);
        
        Ok((
            id,
            StreamWriter {
                id,
                tx: self.tx.clone(),
            },
        ))
    }

    /// Mark a stream as closed
    pub async fn close_stream(&self, id: StreamId) {
        let mut active = self.active_streams.lock().await;
        active.remove(&id);
    }

    /// Check if there are any active streams
    pub async fn has_active_streams(&self) -> bool {
        let active = self.active_streams.lock().await;
        !active.is_empty()
    }

    /// Get the number of active streams
    pub async fn active_count(&self) -> usize {
        let active = self.active_streams.lock().await;
        active.len()
    }
}

impl Default for StreamMultiplexer {
    fn default() -> Self {
        Self::new().0
    }
}

/// Write multiplexed stream messages to an async writer
pub async fn write_stream_messages<W: AsyncWrite + Unpin>(
    mut rx: mpsc::UnboundedReceiver<StreamMessage>,
    writer: &mut W,
) -> Result<(), StreamcableError> {
    while let Some(message) = rx.recv().await {
        match message {
            StreamMessage::Data(id, data) => {
                // Write stream ID
                writer.write_u8((id >> 8) as u8).await?;
                writer.write_u8((id & 0xff) as u8).await?;
                
                // Write data length and data
                let mut len_buf = vec![0u8; get_rolling_uint_size(data.len() as u64)];
                write_rolling_uint_no_alloc(data.len() as u64, &mut len_buf, 0);
                writer.write_all(&len_buf).await?;
                writer.write_all(&data).await?;
            }
            StreamMessage::Close(id) => {
                // Write stream ID
                writer.write_u8((id >> 8) as u8).await?;
                writer.write_u8((id & 0xff) as u8).await?;
                
                // Write zero length to indicate close
                writer.write_u8(0).await?;
            }
            StreamMessage::Error(id, msg) => {
                // Write stream ID
                writer.write_u8((id >> 8) as u8).await?;
                writer.write_u8((id & 0xff) as u8).await?;
                
                // Write error flag (255) followed by error message
                writer.write_u8(0xff).await?;
                let msg_bytes = msg.as_bytes();
                let mut len_buf = vec![0u8; get_rolling_uint_size(msg_bytes.len() as u64)];
                write_rolling_uint_no_alloc(msg_bytes.len() as u64, &mut len_buf, 0);
                writer.write_all(&len_buf).await?;
                writer.write_all(msg_bytes).await?;
            }
        }
        writer.flush().await?;
    }
    Ok(())
}

/// Serialize a Promise value
pub async fn serialize_promise(
    multiplexer: &StreamMultiplexer,
    receiver: tokio::sync::oneshot::Receiver<Box<Value>>,
    inner_schema: &crate::schema::Schema,
) -> Result<StreamId, StreamcableError> {
    let (id, writer) = multiplexer.create_stream().await?;
    
    let inner_schema = inner_schema.clone();
    tokio::spawn(async move {
        match receiver.await {
            Ok(value) => {
                // Serialize the resolved value
                // For now, we'll just send a success flag
                // Full implementation would serialize the value
                let _ = writer.write(vec![1]); // success flag
                let _ = writer.close();
            }
            Err(_) => {
                let _ = writer.error("Promise rejected or dropped".to_string());
            }
        }
    });
    
    Ok(id)
}

/// Serialize an Iterator/Stream value
pub async fn serialize_iterator(
    multiplexer: &StreamMultiplexer,
    mut stream: ValueStream,
) -> Result<StreamId, StreamcableError> {
    let (id, writer) = multiplexer.create_stream().await?;
    
    tokio::spawn(async move {
        while let Some(result) = stream.next().await {
            match result {
                Ok(value) => {
                    // Send continuation flag and value
                    // Full implementation would serialize the value
                    let _ = writer.write(vec![1]); // continuation flag
                }
                Err(e) => {
                    let _ = writer.error(format!("Stream error: {}", e));
                    return;
                }
            }
        }
        // Send end flag
        let _ = writer.write(vec![0]); // end flag
        let _ = writer.close();
    });
    
    Ok(id)
}

/// Serialize a ByteStream value
pub async fn serialize_byte_stream(
    multiplexer: &StreamMultiplexer,
    mut stream: ByteStream,
) -> Result<StreamId, StreamcableError> {
    let (id, writer) = multiplexer.create_stream().await?;
    
    tokio::spawn(async move {
        while let Some(result) = stream.next().await {
            match result {
                Ok(bytes) => {
                    if !bytes.is_empty() {
                        let _ = writer.write(bytes.to_vec());
                    }
                }
                Err(e) => {
                    let _ = writer.error(format!("Stream error: {}", e));
                    return;
                }
            }
        }
        let _ = writer.close();
    });
    
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_stream_multiplexer_creation() {
        let (multiplexer, _rx) = StreamMultiplexer::new();
        assert_eq!(multiplexer.active_count().await, 0);
        assert!(!multiplexer.has_active_streams().await);
    }

    #[tokio::test]
    async fn test_create_stream() {
        let (multiplexer, _rx) = StreamMultiplexer::new();
        let (id1, _writer1) = multiplexer.create_stream().await.unwrap();
        let (id2, _writer2) = multiplexer.create_stream().await.unwrap();
        
        assert_ne!(id1, id2);
        assert_eq!(multiplexer.active_count().await, 2);
        assert!(multiplexer.has_active_streams().await);
    }

    #[tokio::test]
    async fn test_close_stream() {
        let (multiplexer, _rx) = StreamMultiplexer::new();
        let (id, _writer) = multiplexer.create_stream().await.unwrap();
        
        assert_eq!(multiplexer.active_count().await, 1);
        multiplexer.close_stream(id).await;
        assert_eq!(multiplexer.active_count().await, 0);
    }
}
