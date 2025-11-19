//! Basic example showing serialization and deserialization

use std::collections::HashMap;
use streamcable::{deserialize, serialize, Schema, Value};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== Streamcable Rust Example ===\n");

    // Example 1: Simple types
    println!("Example 1: Simple types");
    {
        let schema = Schema::uint();
        let value = Value::Uint(42);
        
        let mut buffer = Vec::new();
        serialize(&schema, &value, &mut buffer, true).await?;
        println!("  Serialized uint(42) to {} bytes", buffer.len());
        
        let (_, deserialized) = deserialize(&buffer[..], None).await?;
        println!("  Deserialized: {:?}\n", deserialized);
    }

    // Example 2: String
    println!("Example 2: String");
    {
        let schema = Schema::string();
        let value = Value::String("Hello, Streamcable!".to_string());
        
        let mut buffer = Vec::new();
        serialize(&schema, &value, &mut buffer, true).await?;
        println!("  Serialized string to {} bytes", buffer.len());
        
        let (_, deserialized) = deserialize(&buffer[..], None).await?;
        println!("  Deserialized: {:?}\n", deserialized);
    }

    // Example 3: Object (like a struct)
    println!("Example 3: Object");
    {
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
        serialize(&schema, &value, &mut buffer, true).await?;
        println!("  Serialized object to {} bytes", buffer.len());
        
        let (_, deserialized) = deserialize(&buffer[..], None).await?;
        println!("  Deserialized: {:?}\n", deserialized);
    }

    // Example 4: Array
    println!("Example 4: Array");
    {
        let schema = Schema::array(Schema::uint());
        let value = Value::Array(vec![
            Value::Uint(1),
            Value::Uint(2),
            Value::Uint(3),
            Value::Uint(4),
            Value::Uint(5),
        ]);
        
        let mut buffer = Vec::new();
        serialize(&schema, &value, &mut buffer, true).await?;
        println!("  Serialized array to {} bytes", buffer.len());
        
        let (_, deserialized) = deserialize(&buffer[..], None).await?;
        println!("  Deserialized: {:?}\n", deserialized);
    }

    // Example 5: Nested object with array
    println!("Example 5: Nested object with array");
    {
        let schema = Schema::object(vec![
            ("id".to_string(), Schema::uint()),
            ("name".to_string(), Schema::string()),
            ("tags".to_string(), Schema::array(Schema::string())),
        ]);
        
        let mut obj = HashMap::new();
        obj.insert("id".to_string(), Value::Uint(123));
        obj.insert("name".to_string(), Value::String("Product".to_string()));
        obj.insert(
            "tags".to_string(),
            Value::Array(vec![
                Value::String("electronics".to_string()),
                Value::String("gadget".to_string()),
            ]),
        );
        let value = Value::Object(obj);
        
        let mut buffer = Vec::new();
        serialize(&schema, &value, &mut buffer, true).await?;
        println!("  Serialized nested object to {} bytes", buffer.len());
        
        let (_, deserialized) = deserialize(&buffer[..], None).await?;
        println!("  Deserialized: {:?}\n", deserialized);
    }

    // Example 6: Map
    println!("Example 6: Map");
    {
        let schema = Schema::map(Schema::string(), Schema::uint());
        let value = Value::Map(vec![
            (Value::String("apple".to_string()), Value::Uint(5)),
            (Value::String("banana".to_string()), Value::Uint(3)),
            (Value::String("orange".to_string()), Value::Uint(7)),
        ]);
        
        let mut buffer = Vec::new();
        serialize(&schema, &value, &mut buffer, true).await?;
        println!("  Serialized map to {} bytes", buffer.len());
        
        let (_, deserialized) = deserialize(&buffer[..], None).await?;
        println!("  Deserialized: {:?}\n", deserialized);
    }

    // Example 7: Union type
    println!("Example 7: Union type");
    {
        let schema = Schema::union(vec![
            Schema::string(),
            Schema::uint(),
            Schema::boolean(),
        ]);
        
        // Try different values
        for value in vec![
            Value::String("text".to_string()),
            Value::Uint(99),
            Value::Boolean(false),
        ] {
            let mut buffer = Vec::new();
            serialize(&schema, &value, &mut buffer, false).await?;
            let (_, deserialized) = deserialize(&buffer[..], Some(schema.clone())).await?;
            println!("  Union value: {:?}", deserialized);
        }
        println!();
    }

    // Example 8: Optional and Nullable
    println!("Example 8: Optional and Nullable");
    {
        let schema_optional = Schema::optional(Schema::string());
        
        // With value
        let mut buffer = Vec::new();
        serialize(
            &schema_optional,
            &Value::String("present".to_string()),
            &mut buffer,
            true,
        )
        .await?;
        let (_, deserialized) = deserialize(&buffer[..], None).await?;
        println!("  Optional with value: {:?}", deserialized);
        
        // Without value (null)
        let mut buffer = Vec::new();
        serialize(&schema_optional, &Value::Null, &mut buffer, false).await?;
        let (_, deserialized) = deserialize(&buffer[..], Some(schema_optional)).await?;
        println!("  Optional without value: {:?}\n", deserialized);
    }

    println!("All examples completed successfully!");
    Ok(())
}
