import { describe, it, expect } from "vitest";
import { ValidationError, pipe, any, string, uint } from "../schemas";
import { OutOfDataError, ReadContext } from "../ReadContext";
import { serialize } from "../serialize";
import { deserialize, getHash } from "../deserialize";
import { Writable } from "stream";

// Helper to create a simple serialize/deserialize flow for testing
async function serializeToBuffer<T>(
    schema: any,
    data: T,
): Promise<Uint8Array> {
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

describe("Error Handling", () => {
    describe("ValidationError", () => {
        it("should be thrown with the correct message", () => {
            const error = new ValidationError("Test validation error");
            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(ValidationError);
            expect(error.message).toBe("Test validation error");
            expect(error.name).toBe("ValidationError");
        });
    });

    describe("OutOfDataError", () => {
        it("should be thrown when reading past end of stream", async () => {
            const buffer = new Uint8Array([1, 2, 3]);
            const stream = new ReadableStream({
                start(controller) {
                    controller.enqueue(buffer);
                    controller.close();
                },
            });

            const readContext = new ReadContext(stream.getReader());

            // Read all bytes
            await readContext.readByte();
            await readContext.readByte();
            await readContext.readByte();

            // Try to read past the end
            await expect(readContext.readByte()).rejects.toThrow(
                OutOfDataError,
            );
        });

        it("should have correct error message", () => {
            const error = new OutOfDataError();
            expect(error.message).toBe("Attempt to read past end of stream");
        });
    });
});

describe("Utility Functions", () => {
    describe("pipe", () => {
        it("should transform data before validation", async () => {
            const schema = pipe(string(), (str) => str.toUpperCase());
            const data = "hello";

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<string>(schema, buffer);

            expect(result).toBe("HELLO");
        });

        it("should apply trim transformation", async () => {
            const schema = pipe(string(), (str) => str.trim());
            const data = "  hello  ";

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<string>(schema, buffer);

            expect(result).toBe("hello");
        });

        it("should throw if transformed data doesn't match schema", () => {
            const schema = pipe(string(), (str: any) => 123 as any);
            expect(() => schema.validateAndMakeWriter("test")).toThrow(
                ValidationError,
            );
        });
    });

    describe("any", () => {
        it("should serialize and deserialize strings", async () => {
            const schema = any();
            const data = "hello world";

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<any>(schema, buffer);

            expect(result).toBe(data);
        });

        it("should serialize and deserialize numbers", async () => {
            const schema = any();
            const data = 42;

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<any>(schema, buffer);

            expect(result).toBe(data);
        });

        it("should serialize and deserialize booleans", async () => {
            const schema = any();
            const data = true;

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<any>(schema, buffer);

            expect(result).toBe(data);
        });

        it("should serialize and deserialize arrays", async () => {
            const schema = any();
            const data = [1, 2, 3];

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<any>(schema, buffer);

            expect(result).toEqual(data);
        });

        it("should serialize and deserialize objects", async () => {
            const schema = any();
            const data = { name: "Alice", age: 30 };

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<any>(schema, buffer);

            expect(result).toEqual(data);
        });

        it("should serialize and deserialize null", async () => {
            const schema = any();
            const data = null;

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<any>(schema, buffer);

            expect(result).toBeNull();
        });

        it("should serialize and deserialize Uint8Array", async () => {
            const schema = any();
            const data = new Uint8Array([1, 2, 3, 4, 5]);

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<any>(schema, buffer);

            expect(result).toEqual(data);
        });

        it("should serialize and deserialize Map", async () => {
            const schema = any();
            const data = new Map([
                ["key1", 1],
                ["key2", 2],
            ]);

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<any>(schema, buffer);

            expect(result).toEqual(data);
        });

        it("should serialize and deserialize Date", async () => {
            const schema = any();
            const data = new Date("2023-01-15T12:00:00.000Z");

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<any>(schema, buffer);

            expect(result).toEqual(data);
        });
    });

    describe("getHash", () => {
        it("should return consistent hash for the same schema", async () => {
            const schema = string();
            const hash1 = await getHash(schema);
            const hash2 = await getHash(schema);

            expect(hash1).toBe(hash2);
            expect(typeof hash1).toBe("string");
            expect(hash1.length).toBeGreaterThan(0);
        });

        it("should return different hashes for different schemas", async () => {
            const schema1 = string();
            const schema2 = uint();

            const hash1 = await getHash(schema1);
            const hash2 = await getHash(schema2);

            expect(hash1).not.toBe(hash2);
        });

        it("should cache hash results", async () => {
            const schema = string();
            const hash1 = await getHash(schema);
            const hash2 = await getHash(schema);

            // Should return the exact same reference (cached)
            expect(hash1).toBe(hash2);
        });
    });
});

describe("ReadContext", () => {
    it("should read bytes correctly", async () => {
        const buffer = new Uint8Array([1, 2, 3, 4, 5]);
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(buffer);
                controller.close();
            },
        });

        const readContext = new ReadContext(stream.getReader());

        expect(await readContext.readByte()).toBe(1);
        expect(await readContext.readByte()).toBe(2);
        expect(await readContext.readByte()).toBe(3);
    });

    it("should peek bytes without consuming them", async () => {
        const buffer = new Uint8Array([1, 2, 3]);
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(buffer);
                controller.close();
            },
        });

        const readContext = new ReadContext(stream.getReader());

        expect(await readContext.peekByte()).toBe(1);
        expect(await readContext.peekByte()).toBe(1); // Still 1
        expect(await readContext.readByte()).toBe(1); // Now consume it
        expect(await readContext.peekByte()).toBe(2);
    });

    it("should read multiple bytes at once", async () => {
        const buffer = new Uint8Array([1, 2, 3, 4, 5]);
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(buffer);
                controller.close();
            },
        });

        const readContext = new ReadContext(stream.getReader());

        const bytes = await readContext.readBytes(3);
        expect(bytes).toEqual(new Uint8Array([1, 2, 3]));

        const moreByte = await readContext.readByte();
        expect(moreByte).toBe(4);
    });

    it("should handle multiple chunks in stream", async () => {
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array([1, 2]));
                controller.enqueue(new Uint8Array([3, 4]));
                controller.enqueue(new Uint8Array([5]));
                controller.close();
            },
        });

        const readContext = new ReadContext(stream.getReader());

        expect(await readContext.readByte()).toBe(1);
        expect(await readContext.readByte()).toBe(2);
        expect(await readContext.readByte()).toBe(3);
        expect(await readContext.readByte()).toBe(4);
        expect(await readContext.readByte()).toBe(5);
    });
});
