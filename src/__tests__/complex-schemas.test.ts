import { describe, it, expect } from "vitest";
import {
    object,
    array,
    union,
    nullable,
    optional,
    string,
    uint,
    boolean,
    record,
    map,
    uint8array,
    ValidationError,
} from "../schemas";
import { Writable } from "stream";
import { serialize } from "../serialize";
import { deserialize } from "../deserialize";

// Helper to create a simple serialize/deserialize flow for testing
async function serializeToBuffer<T>(schema: any, data: T): Promise<Uint8Array> {
    const chunks: Buffer[] = [];
    const writable = new Writable({
        write(chunk, encoding, callback) {
            chunks.push(Buffer.from(chunk));
            callback();
        },
    });

    await serialize(schema, writable, data);

    return new Uint8Array(Buffer.concat(chunks));
}

async function deserializeFromBuffer<T>(
    schema: any,
    buffer: Uint8Array,
): Promise<T> {
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

describe("Complex Schema Types", () => {
    describe("object", () => {
        it("should serialize and deserialize simple objects", async () => {
            const schema = object({
                name: string(),
                age: uint(),
                active: boolean(),
            });

            const data = {
                name: "Alice",
                age: 30,
                active: true,
            };

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<typeof data>(
                schema,
                buffer,
            );

            expect(result).toEqual(data);
        });

        it("should serialize and deserialize nested objects", async () => {
            const schema = object({
                user: object({
                    name: string(),
                    age: uint(),
                }),
                active: boolean(),
            });

            const data = {
                user: {
                    name: "Bob",
                    age: 25,
                },
                active: false,
            };

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<typeof data>(
                schema,
                buffer,
            );

            expect(result).toEqual(data);
        });

        it("should throw ValidationError for non-objects", () => {
            const schema = object({ name: string() });
            expect(() => schema.validateAndMakeWriter(null)).toThrow(
                ValidationError,
            );
            expect(() => schema.validateAndMakeWriter([])).toThrow(
                ValidationError,
            );
            expect(() => schema.validateAndMakeWriter("string")).toThrow(
                ValidationError,
            );
        });
    });

    describe("array", () => {
        it("should serialize and deserialize arrays of strings", async () => {
            const schema = array(string());
            const data = ["hello", "world", "test"];

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<string[]>(
                schema,
                buffer,
            );

            expect(result).toEqual(data);
        });

        it("should serialize and deserialize arrays of numbers", async () => {
            const schema = array(uint());
            const data = [1, 2, 3, 42, 100];

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<number[]>(
                schema,
                buffer,
            );

            expect(result).toEqual(data);
        });

        it("should serialize and deserialize empty arrays", async () => {
            const schema = array(string());
            const data: string[] = [];

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<string[]>(
                schema,
                buffer,
            );

            expect(result).toEqual(data);
        });

        it("should serialize and deserialize arrays of objects", async () => {
            const schema = array(
                object({
                    name: string(),
                    value: uint(),
                }),
            );

            const data = [
                { name: "first", value: 1 },
                { name: "second", value: 2 },
            ];

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<typeof data>(
                schema,
                buffer,
            );

            expect(result).toEqual(data);
        });

        it("should throw ValidationError for non-arrays", () => {
            const schema = array(string());
            expect(() => schema.validateAndMakeWriter("not array")).toThrow(
                ValidationError,
            );
            expect(() =>
                schema.validateAndMakeWriter({ 0: "a", 1: "b" }),
            ).toThrow(ValidationError);
        });
    });

    describe("union", () => {
        it("should serialize and deserialize union of string | uint", async () => {
            const schema = union(string(), uint());

            // Test with string
            let buffer = await serializeToBuffer(schema, "hello");
            let result = await deserializeFromBuffer<string | number>(
                schema,
                buffer,
            );
            expect(result).toBe("hello");

            // Test with uint
            buffer = await serializeToBuffer(schema, 42);
            result = await deserializeFromBuffer<string | number>(
                schema,
                buffer,
            );
            expect(result).toBe(42);
        });

        it("should serialize and deserialize union of multiple types", async () => {
            const schema = union(string(), uint(), boolean());

            // Test with boolean
            const buffer = await serializeToBuffer(schema, true);
            const result = await deserializeFromBuffer<
                string | number | boolean
            >(schema, buffer);
            expect(result).toBe(true);
        });

        it("should throw ValidationError when no schema matches", () => {
            const schema = union(string(), uint());
            expect(() => schema.validateAndMakeWriter(null)).toThrow(
                ValidationError,
            );
            expect(() => schema.validateAndMakeWriter([])).toThrow(
                ValidationError,
            );
        });
    });

    describe("nullable", () => {
        it("should serialize and deserialize null", async () => {
            const schema = nullable(string());
            const data = null;

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<string | null>(
                schema,
                buffer,
            );

            expect(result).toBeNull();
        });

        it("should serialize and deserialize non-null values", async () => {
            const schema = nullable(string());
            const data = "hello";

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<string | null>(
                schema,
                buffer,
            );

            expect(result).toBe(data);
        });

        it("should handle nullable without inner schema", async () => {
            const schema = nullable();
            const data = null;

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<null>(schema, buffer);

            expect(result).toBeNull();
        });
    });

    describe("optional", () => {
        it("should serialize and deserialize undefined", async () => {
            const schema = optional(string());
            const data = undefined;

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<string | undefined>(
                schema,
                buffer,
            );

            expect(result).toBeUndefined();
        });

        it("should serialize and deserialize defined values", async () => {
            const schema = optional(string());
            const data = "hello";

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<string | undefined>(
                schema,
                buffer,
            );

            expect(result).toBe(data);
        });
    });

    describe("uint8array", () => {
        it("should serialize and deserialize Uint8Array", async () => {
            const schema = uint8array();
            const data = new Uint8Array([1, 2, 3, 4, 5]);

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<Uint8Array>(
                schema,
                buffer,
            );

            expect(result).toEqual(data);
        });

        it("should handle empty Uint8Array", async () => {
            const schema = uint8array();
            const data = new Uint8Array([]);

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<Uint8Array>(
                schema,
                buffer,
            );

            expect(result).toEqual(data);
        });

        it("should throw ValidationError for non-Uint8Array", () => {
            const schema = uint8array();
            expect(() => schema.validateAndMakeWriter([1, 2, 3])).toThrow(
                ValidationError,
            );
        });
    });

    describe("record", () => {
        it("should serialize and deserialize records", async () => {
            const schema = record(uint());
            const data = {
                first: 1,
                second: 2,
                third: 3,
            };

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<Record<string, number>>(
                schema,
                buffer,
            );

            expect(result).toEqual(data);
        });

        it("should handle empty records", async () => {
            const schema = record(string());
            const data = {};

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<Record<string, string>>(
                schema,
                buffer,
            );

            expect(result).toEqual(data);
        });

        it("should throw ValidationError for non-objects", () => {
            const schema = record(uint());
            expect(() => schema.validateAndMakeWriter([])).toThrow(
                ValidationError,
            );
            expect(() => schema.validateAndMakeWriter(null)).toThrow(
                ValidationError,
            );
        });
    });

    describe("map", () => {
        it("should serialize and deserialize Map objects", async () => {
            const schema = map(string(), uint());
            const data = new Map([
                ["first", 1],
                ["second", 2],
                ["third", 3],
            ]);

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<Map<string, number>>(
                schema,
                buffer,
            );

            expect(result).toEqual(data);
        });

        it("should handle empty maps", async () => {
            const schema = map(string(), uint());
            const data = new Map();

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<Map<string, number>>(
                schema,
                buffer,
            );

            expect(result).toEqual(data);
        });

        it("should throw ValidationError for non-Map objects", () => {
            const schema = map(string(), uint());
            expect(() =>
                schema.validateAndMakeWriter({ key: "value" }),
            ).toThrow(ValidationError);
        });
    });
});
