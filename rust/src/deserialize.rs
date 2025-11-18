//! Deserialization functions

use crate::data_types::DataType;
use crate::error::StreamcableError;
use crate::read_context::ReadContext;
use crate::rolling_uint::read_rolling_uint;
use crate::schema::{Schema, Value};
use std::collections::HashMap;
use tokio::io::AsyncRead;

/// Read a schema from the reader
fn read_schema<R: AsyncRead + Unpin>(
    ctx: &mut ReadContext<R>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Schema, StreamcableError>> + '_>> {
    Box::pin(async move {
    let data_type_byte = ctx.read_byte().await?;
    let data_type = DataType::from_u8(data_type_byte)
        .ok_or_else(|| StreamcableError::InvalidData(format!("Unknown data type: {}", data_type_byte)))?;
    
    match data_type {
        DataType::Boolean => Ok(Schema::Boolean),
        DataType::Uint8 => Ok(Schema::Uint8),
        DataType::Uint => Ok(Schema::Uint),
        DataType::Int => Ok(Schema::Int),
        DataType::Float => Ok(Schema::Float),
        DataType::String => Ok(Schema::String),
        DataType::U8Array | DataType::Buffer => Ok(Schema::Bytes),
        DataType::Date => Ok(Schema::Date),
        DataType::Bigint => Ok(Schema::Bigint),
        
        DataType::Array => {
            let elem_schema = read_schema(ctx).await?;
            Ok(Schema::Array(Box::new(elem_schema)))
        }
        
        DataType::Object => {
            let field_count = read_rolling_uint(ctx.reader_mut()).await? as usize;
            let mut fields = Vec::with_capacity(field_count);
            
            for _ in 0..field_count {
                let key_len = read_rolling_uint(ctx.reader_mut()).await? as usize;
                let key_bytes = ctx.read_bytes(key_len).await?;
                let key = String::from_utf8(key_bytes)
                    .map_err(|e| StreamcableError::InvalidData(format!("Invalid UTF-8 in object key: {}", e)))?;
                let value_schema = read_schema(ctx).await?;
                fields.push((key, value_schema));
            }
            
            Ok(Schema::Object(fields))
        }
        
        DataType::Map => {
            let key_schema = read_schema(ctx).await?;
            let value_schema = read_schema(ctx).await?;
            Ok(Schema::Map(Box::new(key_schema), Box::new(value_schema)))
        }
        
        DataType::Nullable => {
            let next_byte = ctx.read_byte().await?;
            if next_byte == 0x00 {
                Ok(Schema::Nullable(None))
            } else {
                // Put the byte back by creating a new context with it prepended
                // For simplicity, we'll read the schema assuming the byte was part of it
                let inner_type = DataType::from_u8(next_byte)
                    .ok_or_else(|| StreamcableError::InvalidData(format!("Unknown data type: {}", next_byte)))?;
                
                // Recursively build the schema based on the type
                let inner_schema = match inner_type {
                    DataType::Boolean => Schema::Boolean,
                    DataType::Uint8 => Schema::Uint8,
                    DataType::Uint => Schema::Uint,
                    DataType::Int => Schema::Int,
                    DataType::Float => Schema::Float,
                    DataType::String => Schema::String,
                    DataType::U8Array | DataType::Buffer => Schema::Bytes,
                    DataType::Date => Schema::Date,
                    DataType::Bigint => Schema::Bigint,
                    _ => {
                        // For complex types, we need to continue reading
                        return Err(StreamcableError::Unsupported("Complex nullable types not yet fully supported in this implementation".to_string()));
                    }
                };
                
                Ok(Schema::Nullable(Some(Box::new(inner_schema))))
            }
        }
        
        DataType::Optional => {
            let inner_schema = read_schema(ctx).await?;
            Ok(Schema::Optional(Box::new(inner_schema)))
        }
        
        DataType::Union => {
            let count = read_rolling_uint(ctx.reader_mut()).await? as usize + 1;
            let mut schemas = Vec::with_capacity(count);
            for _ in 0..count {
                schemas.push(read_schema(ctx).await?);
            }
            Ok(Schema::Union(schemas))
        }
        
        DataType::Record => {
            let value_schema = read_schema(ctx).await?;
            Ok(Schema::Record(Box::new(value_schema)))
        }
        
        _ => Err(StreamcableError::Unsupported(format!("Data type {:?} not yet supported", data_type))),
    }
    })
}

/// Read a value according to the schema
fn read_value<'a, R: AsyncRead + Unpin>(
    schema: &'a Schema,
    ctx: &'a mut ReadContext<R>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Value, StreamcableError>> + 'a>> {
    Box::pin(async move {
    match schema {
        Schema::Boolean => {
            let byte = ctx.read_byte().await?;
            match byte {
                0 => Ok(Value::Boolean(false)),
                1 => Ok(Value::Boolean(true)),
                _ => Err(StreamcableError::InvalidData(format!("Invalid boolean value: {}", byte))),
            }
        }
        
        Schema::Uint8 => {
            let byte = ctx.read_byte().await?;
            Ok(Value::Uint8(byte))
        }
        
        Schema::Uint => {
            let value = read_rolling_uint(ctx.reader_mut()).await?;
            Ok(Value::Uint(value))
        }
        
        Schema::Int => {
            let zigzagged = read_rolling_uint(ctx.reader_mut()).await?;
            // Decode zigzag encoding
            let value = ((zigzagged >> 1) as i64) ^ (-((zigzagged & 1) as i64));
            Ok(Value::Int(value))
        }
        
        Schema::Float => {
            let bytes = ctx.read_bytes(8).await?;
            let mut arr = [0u8; 8];
            arr.copy_from_slice(&bytes);
            let value = f64::from_le_bytes(arr);
            Ok(Value::Float(value))
        }
        
        Schema::Bigint => {
            let bytes = ctx.read_bytes(8).await?;
            let mut arr = [0u8; 8];
            arr.copy_from_slice(&bytes);
            let value = u64::from_le_bytes(arr);
            Ok(Value::Bigint(value))
        }
        
        Schema::String => {
            let len = read_rolling_uint(ctx.reader_mut()).await? as usize;
            let bytes = ctx.read_bytes(len).await?;
            let value = String::from_utf8(bytes)
                .map_err(|e| StreamcableError::InvalidData(format!("Invalid UTF-8: {}", e)))?;
            Ok(Value::String(value))
        }
        
        Schema::Bytes => {
            let len = read_rolling_uint(ctx.reader_mut()).await? as usize;
            let bytes = ctx.read_bytes(len).await?;
            Ok(Value::Bytes(bytes))
        }
        
        Schema::Array(elem_schema) => {
            let len = read_rolling_uint(ctx.reader_mut()).await? as usize;
            let mut items = Vec::with_capacity(len);
            for _ in 0..len {
                items.push(read_value(elem_schema, ctx).await?);
            }
            Ok(Value::Array(items))
        }
        
        Schema::Object(fields) => {
            let mut obj = HashMap::new();
            for (field_name, field_schema) in fields {
                let value = read_value(field_schema, ctx).await?;
                obj.insert(field_name.clone(), value);
            }
            Ok(Value::Object(obj))
        }
        
        Schema::Map(key_schema, value_schema) => {
            let len = read_rolling_uint(ctx.reader_mut()).await? as usize;
            let mut entries = Vec::with_capacity(len);
            for _ in 0..len {
                let key = read_value(key_schema, ctx).await?;
                let value = read_value(value_schema, ctx).await?;
                entries.push((key, value));
            }
            Ok(Value::Map(entries))
        }
        
        Schema::Nullable(inner) => {
            let flag = ctx.read_byte().await?;
            match flag {
                0 => Ok(Value::Null),
                1 => {
                    if let Some(inner_schema) = inner {
                        read_value(inner_schema, ctx).await
                    } else {
                        Err(StreamcableError::InvalidData("Unexpected non-null value for null-only nullable".to_string()))
                    }
                }
                _ => Err(StreamcableError::InvalidData(format!("Invalid nullable flag: {}", flag))),
            }
        }
        
        Schema::Optional(inner) => {
            let flag = ctx.read_byte().await?;
            match flag {
                0 => Ok(Value::Null),
                1 => read_value(inner, ctx).await,
                _ => Err(StreamcableError::InvalidData(format!("Invalid optional flag: {}", flag))),
            }
        }
        
        Schema::Union(schemas) => {
            let index = read_rolling_uint(ctx.reader_mut()).await? as usize;
            if index >= schemas.len() {
                return Err(StreamcableError::InvalidData(format!("Invalid union index: {}", index)));
            }
            read_value(&schemas[index], ctx).await
        }
        
        Schema::Date => {
            let len = read_rolling_uint(ctx.reader_mut()).await? as usize;
            let bytes = ctx.read_bytes(len).await?;
            let value = String::from_utf8(bytes)
                .map_err(|e| StreamcableError::InvalidData(format!("Invalid UTF-8 in date: {}", e)))?;
            Ok(Value::Date(value))
        }
        
        Schema::Record(value_schema) => {
            let len = read_rolling_uint(ctx.reader_mut()).await? as usize;
            let mut obj = HashMap::new();
            for _ in 0..len {
                let key_len = read_rolling_uint(ctx.reader_mut()).await? as usize;
                let key_bytes = ctx.read_bytes(key_len).await?;
                let key = String::from_utf8(key_bytes)
                    .map_err(|e| StreamcableError::InvalidData(format!("Invalid UTF-8 in record key: {}", e)))?;
                let value = read_value(value_schema, ctx).await?;
                obj.insert(key, value);
            }
            Ok(Value::Object(obj))
        }
    }
    })
}

/// Deserialize a value from an async reader
///
/// # Arguments
///
/// * `reader` - The async reader to read from
/// * `expected_schema` - Optional expected schema. If None, will read schema from stream
///
/// # Returns
///
/// A tuple of (schema, value)
///
/// # Example
///
/// ```rust,no_run
/// use streamcable::deserialize;
/// use tokio::io::BufReader;
///
/// #[tokio::main]
/// async fn main() -> Result<(), Box<dyn std::error::Error>> {
///     let data = vec![1, 0x0a, 42]; // send_schema=true, Uint type, value=42
///     let reader = BufReader::new(&data[..]);
///     let (schema, value) = deserialize(reader, None).await?;
///     println!("Deserialized value: {:?}", value);
///     Ok(())
/// }
/// ```
pub async fn deserialize<R: AsyncRead + Unpin>(
    reader: R,
    expected_schema: Option<Schema>,
) -> Result<(Schema, Value), StreamcableError> {
    let mut ctx = ReadContext::new(reader);
    
    // Read header
    let has_schema = ctx.read_byte().await?;
    
    let schema = if has_schema == 1 {
        // Read schema from stream
        read_schema(&mut ctx).await?
    } else {
        // Use expected schema
        expected_schema.ok_or_else(|| {
            StreamcableError::InvalidData("No schema in stream and no expected schema provided".to_string())
        })?
    };
    
    // Read value
    let value = read_value(&schema, &mut ctx).await?;
    
    Ok((schema, value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_deserialize_uint() {
        let data = vec![1, 0x0a, 42]; // send_schema=true, Uint type, value=42
        let (schema, value) = deserialize(&data[..], None).await.unwrap();
        
        assert!(matches!(schema, Schema::Uint));
        assert!(matches!(value, Value::Uint(42)));
    }

    #[tokio::test]
    async fn test_deserialize_string() {
        let data = vec![0, 5, b'h', b'e', b'l', b'l', b'o']; // send_schema=false, length=5, "hello"
        let expected_schema = Schema::string();
        let (schema, value) = deserialize(&data[..], Some(expected_schema)).await.unwrap();
        
        assert!(matches!(schema, Schema::String));
        if let Value::String(s) = value {
            assert_eq!(s, "hello");
        } else {
            panic!("Expected String value");
        }
    }
}
