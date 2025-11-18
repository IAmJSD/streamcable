//! Schema definitions for Streamcable
//!
//! This module provides the Schema type and various schema constructors

use crate::data_types::DataType;
use crate::error::ValidationError;
use crate::rolling_uint::{get_rolling_uint_size, write_rolling_uint_no_alloc};
use std::collections::HashMap;

/// Value type that can be serialized
#[derive(Debug, Clone)]
pub enum Value {
    /// Boolean value
    Boolean(bool),
    /// Unsigned 8-bit integer
    Uint8(u8),
    /// Unsigned integer
    Uint(u64),
    /// Signed integer
    Int(i64),
    /// Floating point number
    Float(f64),
    /// String
    String(String),
    /// Byte array
    Bytes(Vec<u8>),
    /// Array of values
    Array(Vec<Value>),
    /// Object with string keys
    Object(HashMap<String, Value>),
    /// Map with arbitrary keys
    Map(Vec<(Value, Value)>),
    /// Null value
    Null,
    /// Date (represented as ISO string)
    Date(String),
    /// BigInt (u64)
    Bigint(u64),
}

/// Schema type that defines how data should be serialized/deserialized
#[derive(Debug, Clone)]
pub enum Schema {
    /// Boolean schema
    Boolean,
    /// Unsigned 8-bit integer schema
    Uint8,
    /// Unsigned integer schema
    Uint,
    /// Signed integer schema
    Int,
    /// Floating point schema
    Float,
    /// String schema
    String,
    /// Byte array schema
    Bytes,
    /// Array schema with element type
    Array(Box<Schema>),
    /// Object schema with field definitions
    Object(Vec<(String, Schema)>),
    /// Map schema with key and value types
    Map(Box<Schema>, Box<Schema>),
    /// Nullable schema
    Nullable(Option<Box<Schema>>),
    /// Optional schema
    Optional(Box<Schema>),
    /// Union of multiple schemas
    Union(Vec<Schema>),
    /// Date schema
    Date,
    /// BigInt schema
    Bigint,
    /// Record schema (object with dynamic keys)
    Record(Box<Schema>),
}

impl Schema {
    /// Create a boolean schema
    pub fn boolean() -> Self {
        Schema::Boolean
    }

    /// Create a uint8 schema
    pub fn uint8() -> Self {
        Schema::Uint8
    }

    /// Create a uint schema
    pub fn uint() -> Self {
        Schema::Uint
    }

    /// Create an int schema
    pub fn int() -> Self {
        Schema::Int
    }

    /// Create a float schema
    pub fn float() -> Self {
        Schema::Float
    }

    /// Create a string schema
    pub fn string() -> Self {
        Schema::String
    }

    /// Create a bytes schema
    pub fn bytes() -> Self {
        Schema::Bytes
    }

    /// Create an array schema
    pub fn array(element_schema: Schema) -> Self {
        Schema::Array(Box::new(element_schema))
    }

    /// Create an object schema
    pub fn object(mut fields: Vec<(String, Schema)>) -> Self {
        // Sort fields by name to ensure consistent ordering
        fields.sort_by(|a, b| a.0.cmp(&b.0));
        Schema::Object(fields)
    }

    /// Create a map schema
    pub fn map(key_schema: Schema, value_schema: Schema) -> Self {
        Schema::Map(Box::new(key_schema), Box::new(value_schema))
    }

    /// Create a nullable schema
    pub fn nullable(inner: Option<Schema>) -> Self {
        Schema::Nullable(inner.map(Box::new))
    }

    /// Create an optional schema
    pub fn optional(inner: Schema) -> Self {
        Schema::Optional(Box::new(inner))
    }

    /// Create a union schema
    pub fn union(schemas: Vec<Schema>) -> Self {
        Schema::Union(schemas)
    }

    /// Create a date schema
    pub fn date() -> Self {
        Schema::Date
    }

    /// Create a bigint schema
    pub fn bigint() -> Self {
        Schema::Bigint
    }

    /// Create a record schema
    pub fn record(value_schema: Schema) -> Self {
        Schema::Record(Box::new(value_schema))
    }

    /// Validate that a value matches this schema
    pub fn validate(&self, value: &Value) -> Result<(), ValidationError> {
        match (self, value) {
            (Schema::Boolean, Value::Boolean(_)) => Ok(()),
            (Schema::Boolean, _) => Err(ValidationError::new("Expected boolean")),
            
            (Schema::Uint8, Value::Uint8(_)) => Ok(()),
            (Schema::Uint8, _) => Err(ValidationError::new("Expected uint8")),
            
            (Schema::Uint, Value::Uint(_)) => Ok(()),
            (Schema::Uint, _) => Err(ValidationError::new("Expected uint")),
            
            (Schema::Int, Value::Int(_)) => Ok(()),
            (Schema::Int, _) => Err(ValidationError::new("Expected int")),
            
            (Schema::Float, Value::Float(_)) => Ok(()),
            (Schema::Float, _) => Err(ValidationError::new("Expected float")),
            
            (Schema::String, Value::String(_)) => Ok(()),
            (Schema::String, _) => Err(ValidationError::new("Expected string")),
            
            (Schema::Bytes, Value::Bytes(_)) => Ok(()),
            (Schema::Bytes, _) => Err(ValidationError::new("Expected bytes")),
            
            (Schema::Array(elem_schema), Value::Array(items)) => {
                for item in items {
                    elem_schema.validate(item)?;
                }
                Ok(())
            }
            (Schema::Array(_), _) => Err(ValidationError::new("Expected array")),
            
            (Schema::Object(fields), Value::Object(obj)) => {
                for (field_name, field_schema) in fields {
                    let field_value = obj.get(field_name).ok_or_else(|| {
                        ValidationError::new(format!("Missing field: {}", field_name))
                    })?;
                    field_schema.validate(field_value)?;
                }
                Ok(())
            }
            (Schema::Object(_), _) => Err(ValidationError::new("Expected object")),
            
            (Schema::Map(key_schema, value_schema), Value::Map(entries)) => {
                for (k, v) in entries {
                    key_schema.validate(k)?;
                    value_schema.validate(v)?;
                }
                Ok(())
            }
            (Schema::Map(_, _), _) => Err(ValidationError::new("Expected map")),
            
            (Schema::Nullable(None), Value::Null) => Ok(()),
            (Schema::Nullable(Some(_inner)), Value::Null) => Ok(()),
            (Schema::Nullable(Some(inner)), value) => inner.validate(value),
            (Schema::Nullable(None), _) => Err(ValidationError::new("Expected null")),
            
            (Schema::Optional(_), Value::Null) => Ok(()),
            (Schema::Optional(inner), value) => inner.validate(value),
            
            (Schema::Union(schemas), value) => {
                for schema in schemas {
                    if schema.validate(value).is_ok() {
                        return Ok(());
                    }
                }
                Err(ValidationError::new("Value does not match any schema in union"))
            }
            
            (Schema::Date, Value::Date(_)) => Ok(()),
            (Schema::Date, _) => Err(ValidationError::new("Expected date")),
            
            (Schema::Bigint, Value::Bigint(_)) => Ok(()),
            (Schema::Bigint, _) => Err(ValidationError::new("Expected bigint")),
            
            (Schema::Record(value_schema), Value::Object(obj)) => {
                for (_, v) in obj {
                    value_schema.validate(v)?;
                }
                Ok(())
            }
            (Schema::Record(_), _) => Err(ValidationError::new("Expected record")),
        }
    }

    /// Get the binary representation of this schema
    pub fn to_bytes(&self) -> Vec<u8> {
        match self {
            Schema::Boolean => vec![DataType::Boolean.to_u8()],
            Schema::Uint8 => vec![DataType::Uint8.to_u8()],
            Schema::Uint => vec![DataType::Uint.to_u8()],
            Schema::Int => vec![DataType::Int.to_u8()],
            Schema::Float => vec![DataType::Float.to_u8()],
            Schema::String => vec![DataType::String.to_u8()],
            Schema::Bytes => vec![DataType::U8Array.to_u8()],
            Schema::Date => vec![DataType::Date.to_u8()],
            Schema::Bigint => vec![DataType::Bigint.to_u8()],
            
            Schema::Array(elem) => {
                let mut bytes = vec![DataType::Array.to_u8()];
                bytes.extend_from_slice(&elem.to_bytes());
                bytes
            }
            
            Schema::Object(fields) => {
                let mut sorted_fields = fields.clone();
                sorted_fields.sort_by(|a, b| a.0.cmp(&b.0));
                
                let mut schema_len = 1 + get_rolling_uint_size(sorted_fields.len() as u64);
                for (key, _) in &sorted_fields {
                    schema_len += get_rolling_uint_size(key.len() as u64) + key.len();
                }
                
                let mut schema_bytes = Vec::with_capacity(schema_len + 100); // rough estimate
                schema_bytes.push(DataType::Object.to_u8());
                
                let mut temp_buf = vec![0u8; 10];
                let pos = write_rolling_uint_no_alloc(sorted_fields.len() as u64, &mut temp_buf, 0);
                schema_bytes.extend_from_slice(&temp_buf[..pos]);
                
                for (key, value_schema) in &sorted_fields {
                    let key_bytes = key.as_bytes();
                    let mut temp_buf = vec![0u8; 10];
                    let pos = write_rolling_uint_no_alloc(key.len() as u64, &mut temp_buf, 0);
                    schema_bytes.extend_from_slice(&temp_buf[..pos]);
                    schema_bytes.extend_from_slice(key_bytes);
                    schema_bytes.extend_from_slice(&value_schema.to_bytes());
                }
                
                schema_bytes
            }
            
            Schema::Map(key_schema, value_schema) => {
                let mut bytes = vec![DataType::Map.to_u8()];
                bytes.extend_from_slice(&key_schema.to_bytes());
                bytes.extend_from_slice(&value_schema.to_bytes());
                bytes
            }
            
            Schema::Nullable(inner) => {
                let mut bytes = vec![DataType::Nullable.to_u8()];
                if let Some(inner_schema) = inner {
                    bytes.extend_from_slice(&inner_schema.to_bytes());
                } else {
                    bytes.push(0x00);
                }
                bytes
            }
            
            Schema::Optional(inner) => {
                let mut bytes = vec![DataType::Optional.to_u8()];
                bytes.extend_from_slice(&inner.to_bytes());
                bytes
            }
            
            Schema::Union(schemas) => {
                let mut bytes = vec![DataType::Union.to_u8()];
                let mut temp_buf = vec![0u8; 10];
                let pos = write_rolling_uint_no_alloc(schemas.len() as u64 - 1, &mut temp_buf, 0);
                bytes.extend_from_slice(&temp_buf[..pos]);
                for schema in schemas {
                    bytes.extend_from_slice(&schema.to_bytes());
                }
                bytes
            }
            
            Schema::Record(value_schema) => {
                let mut bytes = vec![DataType::Record.to_u8()];
                bytes.extend_from_slice(&value_schema.to_bytes());
                bytes
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_schema_validation() {
        let schema = Schema::uint();
        assert!(schema.validate(&Value::Uint(42)).is_ok());
        assert!(schema.validate(&Value::String("hello".to_string())).is_err());
    }

    #[test]
    fn test_schema_to_bytes() {
        assert_eq!(Schema::boolean().to_bytes(), vec![DataType::Boolean.to_u8()]);
        assert_eq!(Schema::uint().to_bytes(), vec![DataType::Uint.to_u8()]);
        assert_eq!(Schema::string().to_bytes(), vec![DataType::String.to_u8()]);
    }
}
