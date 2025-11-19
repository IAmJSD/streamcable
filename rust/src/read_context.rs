//! Read context for deserializing data

use crate::error::StreamcableError;
use tokio::io::{AsyncRead, AsyncReadExt};

/// Context for reading data during deserialization
pub struct ReadContext<R: AsyncRead + Unpin> {
    reader: R,
}

impl<R: AsyncRead + Unpin> ReadContext<R> {
    /// Create a new read context from an async reader
    pub fn new(reader: R) -> Self {
        Self { reader }
    }

    /// Read a single byte
    pub async fn read_byte(&mut self) -> Result<u8, StreamcableError> {
        self.reader.read_u8().await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::UnexpectedEof {
                StreamcableError::OutOfData
            } else {
                StreamcableError::Io(e)
            }
        })
    }

    /// Read a specific number of bytes
    pub async fn read_bytes(&mut self, len: usize) -> Result<Vec<u8>, StreamcableError> {
        let mut buf = vec![0u8; len];
        self.reader.read_exact(&mut buf).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::UnexpectedEof {
                StreamcableError::OutOfData
            } else {
                StreamcableError::Io(e)
            }
        })?;
        Ok(buf)
    }

    /// Get a mutable reference to the underlying reader
    pub fn reader_mut(&mut self) -> &mut R {
        &mut self.reader
    }
}
