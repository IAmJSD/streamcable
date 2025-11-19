//! Data type constants for Streamcable binary protocol

/// Data type identifiers used in the binary protocol
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum DataType {
    // 0x00 is reserved
    Array = 0x01,
    Object = 0x02,
    String = 0x03,
    
    // Separate so that JS can distinguish between Uint8Array and Buffer
    // In most languages, treat both as byte arrays.
    U8Array = 0x04,
    Buffer = 0x05,
    
    Promise = 0x06,
    Iterator = 0x07,
    Boolean = 0x08,
    Uint8 = 0x09,
    Uint = 0x0a,
    Union = 0x0b,
    Date = 0x0c,
    Int = 0x0d,
    Float = 0x0e,
    Nullable = 0x0f,
    Optional = 0x10,
    Bigint = 0x11,
    ReadableStream = 0x12,
    
    // Separate so that new types can be added later without conflict
    // In most languages, treat both as maps
    Record = 0x13,
    Map = 0x14,
    
    Any = 0x15,
}

impl DataType {
    /// Convert from u8 to DataType
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0x01 => Some(DataType::Array),
            0x02 => Some(DataType::Object),
            0x03 => Some(DataType::String),
            0x04 => Some(DataType::U8Array),
            0x05 => Some(DataType::Buffer),
            0x06 => Some(DataType::Promise),
            0x07 => Some(DataType::Iterator),
            0x08 => Some(DataType::Boolean),
            0x09 => Some(DataType::Uint8),
            0x0a => Some(DataType::Uint),
            0x0b => Some(DataType::Union),
            0x0c => Some(DataType::Date),
            0x0d => Some(DataType::Int),
            0x0e => Some(DataType::Float),
            0x0f => Some(DataType::Nullable),
            0x10 => Some(DataType::Optional),
            0x11 => Some(DataType::Bigint),
            0x12 => Some(DataType::ReadableStream),
            0x13 => Some(DataType::Record),
            0x14 => Some(DataType::Map),
            0x15 => Some(DataType::Any),
            _ => None,
        }
    }
    
    /// Convert to u8
    pub fn to_u8(self) -> u8 {
        self as u8
    }
}
