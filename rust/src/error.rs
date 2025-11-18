//! Error types for Streamcable

use std::fmt;

/// Main error type for Streamcable operations
#[derive(Debug)]
pub enum StreamcableError {
    /// Validation error during serialization
    Validation(ValidationError),
    /// Error reading from stream
    Io(std::io::Error),
    /// Unexpected end of stream
    OutOfData,
    /// Invalid data format
    InvalidData(String),
    /// Unsupported operation
    Unsupported(String),
}

impl fmt::Display for StreamcableError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StreamcableError::Validation(e) => write!(f, "Validation error: {}", e),
            StreamcableError::Io(e) => write!(f, "I/O error: {}", e),
            StreamcableError::OutOfData => write!(f, "Attempt to read past end of stream"),
            StreamcableError::InvalidData(msg) => write!(f, "Invalid data: {}", msg),
            StreamcableError::Unsupported(msg) => write!(f, "Unsupported: {}", msg),
        }
    }
}

impl std::error::Error for StreamcableError {}

impl From<std::io::Error> for StreamcableError {
    fn from(err: std::io::Error) -> Self {
        StreamcableError::Io(err)
    }
}

impl From<ValidationError> for StreamcableError {
    fn from(err: ValidationError) -> Self {
        StreamcableError::Validation(err)
    }
}

/// Error thrown when data validation fails
#[derive(Debug)]
pub struct ValidationError {
    pub message: String,
}

impl ValidationError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for ValidationError {}
