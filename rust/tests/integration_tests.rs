//! Integration tests for Streamcable Rust implementation

use std::collections::HashMap;
use streamcable::{deserialize, serialize, Schema, Value};

#[tokio::test]
async fn test_roundtrip_all_types() {
    // Test all basic types
    let test_cases = vec![
        (Schema::boolean(), Value::Boolean(true)),
        (Schema::boolean(), Value::Boolean(false)),
        (Schema::uint8(), Value::Uint8(42)),
        (Schema::uint8(), Value::Uint8(255)),
        (Schema::uint(), Value::Uint(0)),
        (Schema::uint(), Value::Uint(42)),
        (Schema::uint(), Value::Uint(300)),
        (Schema::uint(), Value::Uint(0xffff)),
        (Schema::uint(), Value::Uint(0x100000000)),
        (Schema::int(), Value::Int(-42)),
        (Schema::int(), Value::Int(42)),
        (Schema::int(), Value::Int(0)),
        (Schema::float(), Value::Float(3.14159)),
        (Schema::float(), Value::Float(-2.71828)),
        (Schema::bigint(), Value::Bigint(0)),
        (Schema::bigint(), Value::Bigint(0xffffffffffffffff)),
        (Schema::string(), Value::String("".to_string())),
        (Schema::string(), Value::String("Hello, World!".to_string())),
        (
            Schema::string(),
            Value::String("Unicode: 你好世界 🌍".to_string()),
        ),
        (Schema::bytes(), Value::Bytes(vec![])),
        (Schema::bytes(), Value::Bytes(vec![1, 2, 3, 4, 5])),
        (
            Schema::date(),
            Value::Date("2024-01-15T10:30:00.000Z".to_string()),
        ),
    ];

    for (schema, value) in test_cases {
        let mut buffer = Vec::new();
        serialize(&schema, &value, &mut buffer, true)
            .await
            .unwrap();

        let (_, deserialized) = deserialize(&buffer[..], None).await.unwrap();
        assert_eq!(format!("{:?}", value), format!("{:?}", deserialized));
    }
}

#[tokio::test]
async fn test_roundtrip_array() {
    let schema = Schema::array(Schema::uint());
    let value = Value::Array(vec![
        Value::Uint(1),
        Value::Uint(2),
        Value::Uint(3),
        Value::Uint(100),
        Value::Uint(1000),
    ]);

    let mut buffer = Vec::new();
    serialize(&schema, &value, &mut buffer, true)
        .await
        .unwrap();

    let (_, deserialized) = deserialize(&buffer[..], None).await.unwrap();
    assert_eq!(format!("{:?}", value), format!("{:?}", deserialized));
}

#[tokio::test]
async fn test_roundtrip_nested_array() {
    let schema = Schema::array(Schema::array(Schema::string()));
    let value = Value::Array(vec![
        Value::Array(vec![
            Value::String("a".to_string()),
            Value::String("b".to_string()),
        ]),
        Value::Array(vec![
            Value::String("c".to_string()),
            Value::String("d".to_string()),
        ]),
    ]);

    let mut buffer = Vec::new();
    serialize(&schema, &value, &mut buffer, true)
        .await
        .unwrap();

    let (_, deserialized) = deserialize(&buffer[..], None).await.unwrap();
    assert_eq!(format!("{:?}", value), format!("{:?}", deserialized));
}

#[tokio::test]
async fn test_roundtrip_object() {
    let schema = Schema::object(vec![
        ("name".to_string(), Schema::string()),
        ("age".to_string(), Schema::uint()),
        ("active".to_string(), Schema::boolean()),
    ]);

    let mut obj = HashMap::new();
    obj.insert("name".to_string(), Value::String("Alice".to_string()));
    obj.insert("age".to_string(), Value::Uint(30));
    obj.insert("active".to_string(), Value::Boolean(true));
    let value = Value::Object(obj);

    let mut buffer = Vec::new();
    serialize(&schema, &value, &mut buffer, true)
        .await
        .unwrap();

    let (_, deserialized) = deserialize(&buffer[..], None).await.unwrap();

    if let Value::Object(result_obj) = deserialized {
        assert_eq!(
            result_obj.get("name"),
            Some(&Value::String("Alice".to_string()))
        );
        assert_eq!(result_obj.get("age"), Some(&Value::Uint(30)));
        assert_eq!(result_obj.get("active"), Some(&Value::Boolean(true)));
    } else {
        panic!("Expected object");
    }
}

#[tokio::test]
async fn test_roundtrip_complex_nested() {
    let schema = Schema::object(vec![
        ("id".to_string(), Schema::uint()),
        (
            "user".to_string(),
            Schema::object(vec![
                ("name".to_string(), Schema::string()),
                ("email".to_string(), Schema::string()),
            ]),
        ),
        ("tags".to_string(), Schema::array(Schema::string())),
    ]);

    let mut user_obj = HashMap::new();
    user_obj.insert("name".to_string(), Value::String("Bob".to_string()));
    user_obj.insert(
        "email".to_string(),
        Value::String("bob@example.com".to_string()),
    );

    let mut obj = HashMap::new();
    obj.insert("id".to_string(), Value::Uint(123));
    obj.insert("user".to_string(), Value::Object(user_obj));
    obj.insert(
        "tags".to_string(),
        Value::Array(vec![
            Value::String("rust".to_string()),
            Value::String("coding".to_string()),
        ]),
    );
    let value = Value::Object(obj);

    let mut buffer = Vec::new();
    serialize(&schema, &value, &mut buffer, true)
        .await
        .unwrap();

    let (_, deserialized) = deserialize(&buffer[..], None).await.unwrap();

    if let Value::Object(result_obj) = deserialized {
        assert_eq!(result_obj.get("id"), Some(&Value::Uint(123)));

        if let Some(Value::Object(user)) = result_obj.get("user") {
            assert_eq!(user.get("name"), Some(&Value::String("Bob".to_string())));
            assert_eq!(
                user.get("email"),
                Some(&Value::String("bob@example.com".to_string()))
            );
        } else {
            panic!("Expected user object");
        }

        if let Some(Value::Array(tags)) = result_obj.get("tags") {
            assert_eq!(tags.len(), 2);
        } else {
            panic!("Expected tags array");
        }
    } else {
        panic!("Expected object");
    }
}

#[tokio::test]
async fn test_roundtrip_map() {
    let schema = Schema::map(Schema::string(), Schema::uint());
    let value = Value::Map(vec![
        (Value::String("apple".to_string()), Value::Uint(5)),
        (Value::String("banana".to_string()), Value::Uint(3)),
    ]);

    let mut buffer = Vec::new();
    serialize(&schema, &value, &mut buffer, true)
        .await
        .unwrap();

    let (_, deserialized) = deserialize(&buffer[..], None).await.unwrap();
    assert_eq!(format!("{:?}", value), format!("{:?}", deserialized));
}

#[tokio::test]
async fn test_roundtrip_nullable() {
    // Nullable with null value
    let schema = Schema::nullable(Some(Schema::string()));
    let value = Value::Null;

    let mut buffer = Vec::new();
    serialize(&schema, &value, &mut buffer, true)
        .await
        .unwrap();

    let (_, deserialized) = deserialize(&buffer[..], None).await.unwrap();
    assert!(matches!(deserialized, Value::Null));

    // Nullable with actual value
    let value = Value::String("hello".to_string());

    let mut buffer = Vec::new();
    serialize(&schema, &value, &mut buffer, true)
        .await
        .unwrap();

    let (_, deserialized) = deserialize(&buffer[..], None).await.unwrap();
    if let Value::String(s) = deserialized {
        assert_eq!(s, "hello");
    } else {
        panic!("Expected string");
    }
}

#[tokio::test]
async fn test_roundtrip_optional() {
    // Optional with undefined (null) value
    let schema = Schema::optional(Schema::uint());
    let value = Value::Null;

    let mut buffer = Vec::new();
    serialize(&schema, &value, &mut buffer, true)
        .await
        .unwrap();

    let (_, deserialized) = deserialize(&buffer[..], None).await.unwrap();
    assert!(matches!(deserialized, Value::Null));

    // Optional with actual value
    let value = Value::Uint(42);

    let mut buffer = Vec::new();
    serialize(&schema, &value, &mut buffer, true)
        .await
        .unwrap();

    let (_, deserialized) = deserialize(&buffer[..], None).await.unwrap();
    assert_eq!(deserialized, Value::Uint(42));
}

#[tokio::test]
async fn test_roundtrip_union() {
    let schema = Schema::union(vec![Schema::string(), Schema::uint(), Schema::boolean()]);

    // Test string variant
    let value = Value::String("text".to_string());
    let mut buffer = Vec::new();
    serialize(&schema, &value, &mut buffer, true)
        .await
        .unwrap();
    let (_, deserialized) = deserialize(&buffer[..], None).await.unwrap();
    assert_eq!(format!("{:?}", value), format!("{:?}", deserialized));

    // Test uint variant
    let value = Value::Uint(99);
    let mut buffer = Vec::new();
    serialize(&schema, &value, &mut buffer, false)
        .await
        .unwrap();
    let (_, deserialized) = deserialize(&buffer[..], Some(schema.clone()))
        .await
        .unwrap();
    assert_eq!(deserialized, Value::Uint(99));

    // Test boolean variant
    let value = Value::Boolean(true);
    let mut buffer = Vec::new();
    serialize(&schema, &value, &mut buffer, false)
        .await
        .unwrap();
    let (_, deserialized) = deserialize(&buffer[..], Some(schema.clone()))
        .await
        .unwrap();
    assert_eq!(deserialized, Value::Boolean(true));
}

#[tokio::test]
async fn test_schema_without_send() {
    // Test serialization without sending schema
    let schema = Schema::uint();
    let value = Value::Uint(123);

    let mut buffer = Vec::new();
    serialize(&schema, &value, &mut buffer, false)
        .await
        .unwrap();

    let (_, deserialized) = deserialize(&buffer[..], Some(schema))
        .await
        .unwrap();
    assert_eq!(deserialized, Value::Uint(123));
}

#[tokio::test]
async fn test_record() {
    let schema = Schema::record(Schema::uint());

    let mut obj = HashMap::new();
    obj.insert("a".to_string(), Value::Uint(1));
    obj.insert("b".to_string(), Value::Uint(2));
    obj.insert("c".to_string(), Value::Uint(3));
    let value = Value::Object(obj);

    let mut buffer = Vec::new();
    serialize(&schema, &value, &mut buffer, true)
        .await
        .unwrap();

    let (_, deserialized) = deserialize(&buffer[..], None).await.unwrap();

    if let Value::Object(result_obj) = deserialized {
        assert_eq!(result_obj.get("a"), Some(&Value::Uint(1)));
        assert_eq!(result_obj.get("b"), Some(&Value::Uint(2)));
        assert_eq!(result_obj.get("c"), Some(&Value::Uint(3)));
    } else {
        panic!("Expected object");
    }
}

#[tokio::test]
async fn test_empty_collections() {
    // Empty array
    let schema = Schema::array(Schema::string());
    let value = Value::Array(vec![]);
    let mut buffer = Vec::new();
    serialize(&schema, &value, &mut buffer, true)
        .await
        .unwrap();
    let (_, deserialized) = deserialize(&buffer[..], None).await.unwrap();
    assert_eq!(format!("{:?}", value), format!("{:?}", deserialized));

    // Empty object
    let schema = Schema::object(vec![]);
    let value = Value::Object(HashMap::new());
    let mut buffer = Vec::new();
    serialize(&schema, &value, &mut buffer, true)
        .await
        .unwrap();
    let (_, deserialized) = deserialize(&buffer[..], None).await.unwrap();
    assert_eq!(format!("{:?}", value), format!("{:?}", deserialized));

    // Empty map
    let schema = Schema::map(Schema::string(), Schema::uint());
    let value = Value::Map(vec![]);
    let mut buffer = Vec::new();
    serialize(&schema, &value, &mut buffer, true)
        .await
        .unwrap();
    let (_, deserialized) = deserialize(&buffer[..], None).await.unwrap();
    assert_eq!(format!("{:?}", value), format!("{:?}", deserialized));
}

#[tokio::test]
async fn test_validation_errors() {
    let schema = Schema::uint();
    let wrong_value = Value::String("not a number".to_string());

    let mut buffer = Vec::new();
    let result = serialize(&schema, &wrong_value, &mut buffer, true).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_large_values() {
    // Large string
    let schema = Schema::string();
    let large_string = "x".repeat(10000);
    let value = Value::String(large_string.clone());

    let mut buffer = Vec::new();
    serialize(&schema, &value, &mut buffer, true)
        .await
        .unwrap();
    let (_, deserialized) = deserialize(&buffer[..], None).await.unwrap();

    if let Value::String(s) = deserialized {
        assert_eq!(s.len(), 10000);
        assert_eq!(s, large_string);
    } else {
        panic!("Expected string");
    }

    // Large array
    let schema = Schema::array(Schema::uint());
    let value = Value::Array((0..1000).map(|i| Value::Uint(i)).collect());

    let mut buffer = Vec::new();
    serialize(&schema, &value, &mut buffer, true)
        .await
        .unwrap();
    let (_, deserialized) = deserialize(&buffer[..], None).await.unwrap();

    if let Value::Array(arr) = deserialized {
        assert_eq!(arr.len(), 1000);
    } else {
        panic!("Expected array");
    }
}
