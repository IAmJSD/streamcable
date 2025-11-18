//! Serialization functions

use crate::error::StreamcableError;
use crate::rolling_uint::{get_rolling_uint_size, write_rolling_uint_no_alloc};
use crate::schema::{Schema, Value};
use tokio::io::{AsyncWrite, AsyncWriteExt};

/// Calculate the size needed to serialize a value
fn calculate_value_size(schema: &Schema, value: &Value) -> Result<usize, StreamcableError> {
    schema.validate(value)?;
    
    match (schema, value) {
        (Schema::Boolean, Value::Boolean(_)) => Ok(1),
        (Schema::Uint8, Value::Uint8(_)) => Ok(1),
        (Schema::Uint, Value::Uint(n)) => Ok(get_rolling_uint_size(*n)),
        (Schema::Int, Value::Int(n)) => {
            // Zigzag encoding
            let zigzagged = ((*n << 1) ^ (*n >> 63)) as u64;
            Ok(get_rolling_uint_size(zigzagged))
        }
        (Schema::Float, Value::Float(_)) => Ok(8),
        (Schema::Bigint, Value::Bigint(_)) => Ok(8),
        
        (Schema::String, Value::String(s)) => {
            let len = s.len();
            Ok(get_rolling_uint_size(len as u64) + len)
        }
        
        (Schema::Bytes, Value::Bytes(bytes)) => {
            let len = bytes.len();
            Ok(get_rolling_uint_size(len as u64) + len)
        }
        
        (Schema::Array(elem_schema), Value::Array(items)) => {
            let mut size = get_rolling_uint_size(items.len() as u64);
            for item in items {
                size += calculate_value_size(elem_schema, item)?;
            }
            Ok(size)
        }
        
        (Schema::Object(fields), Value::Object(obj)) => {
            let mut size = 0;
            for (field_name, field_schema) in fields {
                if let Some(field_value) = obj.get(field_name) {
                    size += calculate_value_size(field_schema, field_value)?;
                }
            }
            Ok(size)
        }
        
        (Schema::Map(key_schema, value_schema), Value::Map(entries)) => {
            let mut size = get_rolling_uint_size(entries.len() as u64);
            for (k, v) in entries {
                size += calculate_value_size(key_schema, k)?;
                size += calculate_value_size(value_schema, v)?;
            }
            Ok(size)
        }
        
        (Schema::Nullable(_), Value::Null) => Ok(1),
        (Schema::Nullable(Some(inner)), value) => {
            Ok(1 + calculate_value_size(inner, value)?)
        }
        
        (Schema::Optional(_), Value::Null) => Ok(1),
        (Schema::Optional(inner), value) => {
            Ok(1 + calculate_value_size(inner, value)?)
        }
        
        (Schema::Union(schemas), value) => {
            for (idx, schema) in schemas.iter().enumerate() {
                if schema.validate(value).is_ok() {
                    let value_size = calculate_value_size(schema, value)?;
                    return Ok(get_rolling_uint_size(idx as u64) + value_size);
                }
            }
            Err(StreamcableError::InvalidData("Value does not match any schema in union".to_string()))
        }
        
        (Schema::Date, Value::Date(s)) => {
            let len = s.len();
            Ok(get_rolling_uint_size(len as u64) + len)
        }
        
        (Schema::Record(value_schema), Value::Object(obj)) => {
            let mut size = get_rolling_uint_size(obj.len() as u64);
            for (key, value) in obj {
                let key_len = key.len();
                size += get_rolling_uint_size(key_len as u64) + key_len;
                size += calculate_value_size(value_schema, value)?;
            }
            Ok(size)
        }
        
        _ => Err(StreamcableError::InvalidData("Schema and value type mismatch".to_string())),
    }
}

/// Write a value to a buffer according to the schema
fn write_value(
    schema: &Schema,
    value: &Value,
    buf: &mut [u8],
    pos: &mut usize,
) -> Result<(), StreamcableError> {
    match (schema, value) {
        (Schema::Boolean, Value::Boolean(b)) => {
            buf[*pos] = if *b { 1 } else { 0 };
            *pos += 1;
            Ok(())
        }
        
        (Schema::Uint8, Value::Uint8(n)) => {
            buf[*pos] = *n;
            *pos += 1;
            Ok(())
        }
        
        (Schema::Uint, Value::Uint(n)) => {
            *pos = write_rolling_uint_no_alloc(*n, buf, *pos);
            Ok(())
        }
        
        (Schema::Int, Value::Int(n)) => {
            // Zigzag encoding
            let zigzagged = ((*n << 1) ^ (*n >> 63)) as u64;
            *pos = write_rolling_uint_no_alloc(zigzagged, buf, *pos);
            Ok(())
        }
        
        (Schema::Float, Value::Float(f)) => {
            let bytes = f.to_le_bytes();
            buf[*pos..*pos + 8].copy_from_slice(&bytes);
            *pos += 8;
            Ok(())
        }
        
        (Schema::Bigint, Value::Bigint(n)) => {
            let bytes = n.to_le_bytes();
            buf[*pos..*pos + 8].copy_from_slice(&bytes);
            *pos += 8;
            Ok(())
        }
        
        (Schema::String, Value::String(s)) => {
            let bytes = s.as_bytes();
            *pos = write_rolling_uint_no_alloc(bytes.len() as u64, buf, *pos);
            buf[*pos..*pos + bytes.len()].copy_from_slice(bytes);
            *pos += bytes.len();
            Ok(())
        }
        
        (Schema::Bytes, Value::Bytes(bytes)) => {
            *pos = write_rolling_uint_no_alloc(bytes.len() as u64, buf, *pos);
            buf[*pos..*pos + bytes.len()].copy_from_slice(bytes);
            *pos += bytes.len();
            Ok(())
        }
        
        (Schema::Array(elem_schema), Value::Array(items)) => {
            *pos = write_rolling_uint_no_alloc(items.len() as u64, buf, *pos);
            for item in items {
                write_value(elem_schema, item, buf, pos)?;
            }
            Ok(())
        }
        
        (Schema::Object(fields), Value::Object(obj)) => {
            for (field_name, field_schema) in fields {
                if let Some(field_value) = obj.get(field_name) {
                    write_value(field_schema, field_value, buf, pos)?;
                }
            }
            Ok(())
        }
        
        (Schema::Map(key_schema, value_schema), Value::Map(entries)) => {
            *pos = write_rolling_uint_no_alloc(entries.len() as u64, buf, *pos);
            for (k, v) in entries {
                write_value(key_schema, k, buf, pos)?;
                write_value(value_schema, v, buf, pos)?;
            }
            Ok(())
        }
        
        (Schema::Nullable(_), Value::Null) => {
            buf[*pos] = 0;
            *pos += 1;
            Ok(())
        }
        
        (Schema::Nullable(Some(inner)), value) => {
            buf[*pos] = 1;
            *pos += 1;
            write_value(inner, value, buf, pos)
        }
        
        (Schema::Optional(_), Value::Null) => {
            buf[*pos] = 0;
            *pos += 1;
            Ok(())
        }
        
        (Schema::Optional(inner), value) => {
            buf[*pos] = 1;
            *pos += 1;
            write_value(inner, value, buf, pos)
        }
        
        (Schema::Union(schemas), value) => {
            for (idx, schema) in schemas.iter().enumerate() {
                if schema.validate(value).is_ok() {
                    *pos = write_rolling_uint_no_alloc(idx as u64, buf, *pos);
                    write_value(schema, value, buf, pos)?;
                    return Ok(());
                }
            }
            Err(StreamcableError::InvalidData("Value does not match any schema in union".to_string()))
        }
        
        (Schema::Date, Value::Date(s)) => {
            let bytes = s.as_bytes();
            *pos = write_rolling_uint_no_alloc(bytes.len() as u64, buf, *pos);
            buf[*pos..*pos + bytes.len()].copy_from_slice(bytes);
            *pos += bytes.len();
            Ok(())
        }
        
        (Schema::Record(value_schema), Value::Object(obj)) => {
            *pos = write_rolling_uint_no_alloc(obj.len() as u64, buf, *pos);
            for (key, value) in obj {
                let key_bytes = key.as_bytes();
                *pos = write_rolling_uint_no_alloc(key_bytes.len() as u64, buf, *pos);
                buf[*pos..*pos + key_bytes.len()].copy_from_slice(key_bytes);
                *pos += key_bytes.len();
                write_value(value_schema, value, buf, pos)?;
            }
            Ok(())
        }
        
        _ => Err(StreamcableError::InvalidData("Schema and value type mismatch".to_string())),
    }
}

/// Serialize a value according to the schema and write it to the async writer
///
/// # Arguments
///
/// * `schema` - The schema defining the structure
/// * `value` - The value to serialize
/// * `writer` - The async writer to write to
/// * `send_schema` - Whether to send the schema along with the data
///
/// # Example
///
/// ```rust,no_run
/// use streamcable::{Schema, Value, serialize};
/// use tokio::io::AsyncWriteExt;
///
/// #[tokio::main]
/// async fn main() -> Result<(), Box<dyn std::error::Error>> {
///     let schema = Schema::object(vec![
///         ("name".to_string(), Schema::string()),
///         ("age".to_string(), Schema::uint()),
///     ]);
///     
///     let mut map = std::collections::HashMap::new();
///     map.insert("name".to_string(), Value::String("Alice".to_string()));
///     map.insert("age".to_string(), Value::Uint(30));
///     let value = Value::Object(map);
///     
///     let mut buffer = Vec::new();
///     serialize(&schema, &value, &mut buffer, true).await?;
///     Ok(())
/// }
/// ```
pub async fn serialize<W: AsyncWrite + Unpin>(
    schema: &Schema,
    value: &Value,
    writer: &mut W,
    send_schema: bool,
) -> Result<(), StreamcableError> {
    // Validate the value matches the schema
    schema.validate(value)?;
    
    // Calculate the total size
    let schema_bytes = if send_schema {
        schema.to_bytes()
    } else {
        Vec::new()
    };
    
    let value_size = calculate_value_size(schema, value)?;
    let total_size = 1 + schema_bytes.len() + value_size;
    
    // Allocate buffer
    let mut buf = vec![0u8; total_size];
    let mut pos = 0;
    
    // Write header
    buf[pos] = if send_schema { 1 } else { 0 };
    pos += 1;
    
    // Write schema if needed
    if send_schema {
        buf[pos..pos + schema_bytes.len()].copy_from_slice(&schema_bytes);
        pos += schema_bytes.len();
    }
    
    // Write value
    write_value(schema, value, &mut buf, &mut pos)?;
    
    // Write to writer
    writer.write_all(&buf).await?;
    writer.flush().await?;
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_serialize_uint() {
        let schema = Schema::uint();
        let value = Value::Uint(42);
        let mut buffer = Vec::new();
        
        serialize(&schema, &value, &mut buffer, true).await.unwrap();
        
        // Should have: header (1 byte) + schema (1 byte) + value (1 byte)
        assert_eq!(buffer.len(), 3);
        assert_eq!(buffer[0], 1); // send_schema = true
        assert_eq!(buffer[1], 0x0a); // DataType::Uint
        assert_eq!(buffer[2], 42); // value
    }

    #[tokio::test]
    async fn test_serialize_string() {
        let schema = Schema::string();
        let value = Value::String("hello".to_string());
        let mut buffer = Vec::new();
        
        serialize(&schema, &value, &mut buffer, false).await.unwrap();
        
        // Should have: header (1 byte) + length (1 byte) + "hello" (5 bytes)
        assert_eq!(buffer.len(), 7);
        assert_eq!(buffer[0], 0); // send_schema = false
        assert_eq!(buffer[1], 5); // string length
        assert_eq!(&buffer[2..7], b"hello");
    }
}
