import { describe, it, expect } from "vitest";
import {
    object,
    array,
    string,
    uint,
    boolean,
    optional,
    nullable,
    union,
} from "../schemas";
import { serialize } from "../serialize";
import { deserialize, getHash } from "../deserialize";
import { Writable } from "stream";

// Helper to create a simple serialize/deserialize flow for testing
async function roundTrip<T>(schema: any, data: T): Promise<T> {
    const chunks: Buffer[] = [];
    const writable = new Writable({
        write(chunk, encoding, callback) {
            chunks.push(Buffer.from(chunk));
            callback();
        },
    });

    await serialize(schema, writable, data);

    const buffer = new Uint8Array(Buffer.concat(chunks));

    return deserialize(schema, async () => {
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(buffer);
                controller.close();
            },
        });
        return stream;
    });
}

describe("Integration Tests - Real World Scenarios", () => {
    it("should handle a user profile schema", async () => {
        const userSchema = object({
            id: uint(),
            name: string(),
            email: string(),
            age: uint(),
            isActive: boolean(),
            bio: optional(string()),
        });

        const userData = {
            id: 123,
            name: "Alice Johnson",
            email: "alice@example.com",
            age: 28,
            isActive: true,
            bio: "Software engineer",
        };

        const result = await roundTrip(userSchema, userData);
        expect(result).toEqual(userData);
    });

    it("should handle a user profile with optional field undefined", async () => {
        const userSchema = object({
            id: uint(),
            name: string(),
            email: string(),
            age: uint(),
            isActive: boolean(),
            bio: optional(string()),
        });

        const userData = {
            id: 456,
            name: "Bob Smith",
            email: "bob@example.com",
            age: 35,
            isActive: false,
            bio: undefined,
        };

        const result = await roundTrip(userSchema, userData);
        expect(result).toEqual(userData);
    });

    it("should handle a list of users", async () => {
        const userSchema = object({
            id: uint(),
            name: string(),
            isActive: boolean(),
        });

        const usersSchema = array(userSchema);

        const usersData = [
            { id: 1, name: "Alice", isActive: true },
            { id: 2, name: "Bob", isActive: false },
            { id: 3, name: "Charlie", isActive: true },
        ];

        const result = await roundTrip(usersSchema, usersData);
        expect(result).toEqual(usersData);
    });

    it("should handle nested objects", async () => {
        const addressSchema = object({
            street: string(),
            city: string(),
            zipCode: string(),
        });

        const companySchema = object({
            name: string(),
            address: addressSchema,
            employees: uint(),
        });

        const companyData = {
            name: "Tech Corp",
            address: {
                street: "123 Main St",
                city: "San Francisco",
                zipCode: "94102",
            },
            employees: 150,
        };

        const result = await roundTrip(companySchema, companyData);
        expect(result).toEqual(companyData);
    });

    it("should handle deeply nested structures", async () => {
        const schema = object({
            level1: object({
                level2: object({
                    level3: object({
                        value: string(),
                    }),
                }),
            }),
        });

        const data = {
            level1: {
                level2: {
                    level3: {
                        value: "deeply nested",
                    },
                },
            },
        };

        const result = await roundTrip(schema, data);
        expect(result).toEqual(data);
    });

    it("should handle complex union types", async () => {
        const messageSchema = union(
            object({
                type: string(),
                text: string(),
            }),
            object({
                type: string(),
                imageUrl: string(),
            }),
            object({
                type: string(),
                value: uint(),
            }),
        );

        // Test text message
        const textMessage = { type: "text", text: "Hello" };
        let result = await roundTrip(messageSchema, textMessage);
        expect(result).toEqual(textMessage);

        // Test image message
        const imageMessage = { type: "image", imageUrl: "https://example.com/img.jpg" };
        result = await roundTrip(messageSchema, imageMessage);
        expect(result).toEqual(imageMessage);

        // Test numeric message
        const numMessage = { type: "number", value: 42 };
        result = await roundTrip(messageSchema, numMessage);
        expect(result).toEqual(numMessage);
    });

    it("should handle arrays with mixed nullable types", async () => {
        const schema = array(nullable(string()));

        const data = ["hello", null, "world", null, "test"];

        const result = await roundTrip(schema, data);
        expect(result).toEqual(data);
    });

    it("should handle complex API response structure", async () => {
        const apiResponseSchema = object({
            status: uint(),
            message: string(),
            data: object({
                items: array(
                    object({
                        id: uint(),
                        title: string(),
                        description: optional(string()),
                        tags: array(string()),
                    }),
                ),
                total: uint(),
                page: uint(),
            }),
        });

        const apiData = {
            status: 200,
            message: "Success",
            data: {
                items: [
                    {
                        id: 1,
                        title: "First Item",
                        description: "Description 1",
                        tags: ["tag1", "tag2"],
                    },
                    {
                        id: 2,
                        title: "Second Item",
                        description: undefined,
                        tags: ["tag3"],
                    },
                ],
                total: 2,
                page: 1,
            },
        };

        const result = await roundTrip(apiResponseSchema, apiData);
        expect(result).toEqual(apiData);
    });

    it("should handle empty arrays and objects", async () => {
        const schema = object({
            emptyArray: array(string()),
            nestedObject: object({
                value: uint(),
            }),
        });

        const data = {
            emptyArray: [],
            nestedObject: {
                value: 0,
            },
        };

        const result = await roundTrip(schema, data);
        expect(result).toEqual(data);
    });

    it("should preserve data types accurately", async () => {
        const schema = object({
            boolean: boolean(),
            string: string(),
            number: uint(),
            nullableString: nullable(string()),
            optionalNumber: optional(uint()),
        });

        const data = {
            boolean: false,
            string: "",
            number: 0,
            nullableString: null,
            optionalNumber: undefined,
        };

        const result = await roundTrip(schema, data);
        expect(result).toEqual(data);
        expect(typeof result.boolean).toBe("boolean");
        expect(typeof result.string).toBe("string");
        expect(typeof result.number).toBe("number");
        expect(result.nullableString).toBeNull();
        expect(result.optionalNumber).toBeUndefined();
    });
});

describe("Integration Tests - Schema Optimization", () => {
    it("should use schema hash for optimization", async () => {
        const schema = object({
            name: string(),
            age: uint(),
        });

        const hash = await getHash(schema);
        expect(typeof hash).toBe("string");
        expect(hash.length).toBeGreaterThan(0);

        const chunks: Buffer[] = [];
        const writable = new Writable({
            write(chunk, encoding, callback) {
                chunks.push(Buffer.from(chunk));
                callback();
            },
        });

        const data = { name: "Alice", age: 30 };

        // Serialize with schema hash optimization
        await serialize(schema, writable, data, hash);

        const buffer = Buffer.concat(chunks);

        // When using the same hash, the schema should not be sent
        // This is indicated by the first byte being 0 instead of 1
        expect(buffer[0]).toBe(0);
    });

    it("should send schema when hash doesn't match", async () => {
        const schema = object({
            name: string(),
            age: uint(),
        });

        const chunks: Buffer[] = [];
        const writable = new Writable({
            write(chunk, encoding, callback) {
                chunks.push(Buffer.from(chunk));
                callback();
            },
        });

        const data = { name: "Alice", age: 30 };

        // Serialize with wrong hash (or no hash)
        await serialize(schema, writable, data, "wrong-hash");

        const buffer = Buffer.concat(chunks);

        // When hash doesn't match, schema should be sent
        // This is indicated by the first byte being 1
        expect(buffer[0]).toBe(1);
    });
});

describe("Integration Tests - Large Data", () => {
    it("should handle large arrays efficiently", async () => {
        const schema = array(uint());

        // Create an array with 1000 elements
        const largeData = Array.from({ length: 1000 }, (_, i) => i);

        const result = await roundTrip(schema, largeData);
        expect(result).toEqual(largeData);
        expect(result.length).toBe(1000);
    });

    it("should handle objects with many properties", async () => {
        // Create a schema with 50 properties
        const properties: any = {};
        for (let i = 0; i < 50; i++) {
            properties[`prop${i}`] = uint();
        }
        const schema = object(properties);

        // Create data object
        const data: any = {};
        for (let i = 0; i < 50; i++) {
            data[`prop${i}`] = i;
        }

        const result = await roundTrip(schema, data);
        expect(result).toEqual(data);
        expect(Object.keys(result).length).toBe(50);
    });

    it("should handle large strings", async () => {
        const schema = string();

        // Create a 10KB string
        const largeString = "a".repeat(10000);

        const result = await roundTrip(schema, largeString);
        expect(result).toBe(largeString);
        expect(result.length).toBe(10000);
    });
});
