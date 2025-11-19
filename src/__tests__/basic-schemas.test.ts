import { describe, it, expect } from "vitest";
import {
    string,
    uint,
    uint8,
    int,
    float,
    boolean,
    bigint,
    date,
    ValidationError,
} from "../schemas";
import { serialize } from "../serialize";
import { deserialize } from "../deserialize";
import { Writable, PassThrough } from "stream";

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

describe("Basic Schema Types", () => {
    describe("string", () => {
        it("should serialize and deserialize a simple string", async () => {
            const schema = string();
            const data = "hello world";

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<string>(schema, buffer);

            expect(result).toBe(data);
        });

        it("should handle empty strings", async () => {
            const schema = string();
            const data = "";

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<string>(schema, buffer);

            expect(result).toBe(data);
        });

        it("should handle unicode characters", async () => {
            const schema = string();
            const data = "Hello 世界 🌍";

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<string>(schema, buffer);

            expect(result).toBe(data);
        });

        it("should throw ValidationError for non-string data", () => {
            const schema = string();
            expect(() => schema.validateAndMakeWriter(123)).toThrow(
                ValidationError,
            );
            expect(() => schema.validateAndMakeWriter(null)).toThrow(
                ValidationError,
            );
            expect(() => schema.validateAndMakeWriter(undefined)).toThrow(
                ValidationError,
            );
        });
    });

    describe("uint", () => {
        it("should serialize and deserialize small unsigned integers", async () => {
            const schema = uint();
            const data = 42;

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<number>(schema, buffer);

            expect(result).toBe(data);
        });

        it("should handle zero", async () => {
            const schema = uint();
            const data = 0;

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<number>(schema, buffer);

            expect(result).toBe(data);
        });

        it("should handle large unsigned integers", async () => {
            const schema = uint();
            const data = 65535;

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<number>(schema, buffer);

            expect(result).toBe(data);
        });

        it("should throw ValidationError for negative numbers", () => {
            const schema = uint();
            expect(() => schema.validateAndMakeWriter(-1)).toThrow(
                ValidationError,
            );
        });

        it("should throw ValidationError for non-integers", () => {
            const schema = uint();
            expect(() => schema.validateAndMakeWriter(3.14)).toThrow(
                ValidationError,
            );
        });

        it("should throw ValidationError for non-numbers", () => {
            const schema = uint();
            expect(() => schema.validateAndMakeWriter("42")).toThrow(
                ValidationError,
            );
        });
    });

    describe("uint8", () => {
        it("should serialize and deserialize uint8 values", async () => {
            const schema = uint8();
            const data = 255;

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<number>(schema, buffer);

            expect(result).toBe(data);
        });

        it("should throw ValidationError for out-of-range values", () => {
            const schema = uint8();
            expect(() => schema.validateAndMakeWriter(256)).toThrow(
                ValidationError,
            );
            expect(() => schema.validateAndMakeWriter(-1)).toThrow(
                ValidationError,
            );
        });
    });

    describe("int", () => {
        it("should serialize and deserialize positive integers", async () => {
            const schema = int();
            const data = 42;

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<number>(schema, buffer);

            expect(result).toBe(data);
        });

        it("should serialize and deserialize negative integers", async () => {
            const schema = int();
            const data = -42;

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<number>(schema, buffer);

            expect(result).toBe(data);
        });

        it("should handle zero", async () => {
            const schema = int();
            const data = 0;

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<number>(schema, buffer);

            expect(result).toBe(data);
        });

        it("should throw ValidationError for non-integers", () => {
            const schema = int();
            expect(() => schema.validateAndMakeWriter(3.14)).toThrow(
                ValidationError,
            );
        });
    });

    describe("float", () => {
        it("should serialize and deserialize floating point numbers", async () => {
            const schema = float();
            const data = 3.14159;

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<number>(schema, buffer);

            expect(result).toBeCloseTo(data, 5);
        });

        it("should handle integers as floats", async () => {
            const schema = float();
            const data = 42;

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<number>(schema, buffer);

            expect(result).toBe(data);
        });

        it("should handle special values", async () => {
            const schema = float();

            // Infinity
            let buffer = await serializeToBuffer(schema, Infinity);
            let result = await deserializeFromBuffer<number>(schema, buffer);
            expect(result).toBe(Infinity);

            // -Infinity
            buffer = await serializeToBuffer(schema, -Infinity);
            result = await deserializeFromBuffer<number>(schema, buffer);
            expect(result).toBe(-Infinity);

            // NaN
            buffer = await serializeToBuffer(schema, NaN);
            result = await deserializeFromBuffer<number>(schema, buffer);
            expect(result).toBeNaN();
        });
    });

    describe("boolean", () => {
        it("should serialize and deserialize true", async () => {
            const schema = boolean();
            const data = true;

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<boolean>(schema, buffer);

            expect(result).toBe(data);
        });

        it("should serialize and deserialize false", async () => {
            const schema = boolean();
            const data = false;

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<boolean>(schema, buffer);

            expect(result).toBe(data);
        });

        it("should throw ValidationError for non-boolean values", () => {
            const schema = boolean();
            expect(() => schema.validateAndMakeWriter(1)).toThrow(
                ValidationError,
            );
            expect(() => schema.validateAndMakeWriter("true")).toThrow(
                ValidationError,
            );
        });
    });

    describe("bigint", () => {
        it("should serialize and deserialize bigint values", async () => {
            const schema = bigint();
            const data = BigInt("9007199254740991");

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<bigint>(schema, buffer);

            expect(result).toBe(data);
        });

        it("should throw ValidationError for non-bigint values", () => {
            const schema = bigint();
            expect(() => schema.validateAndMakeWriter(123)).toThrow(
                ValidationError,
            );
        });
    });

    describe("date", () => {
        it("should serialize and deserialize date objects", async () => {
            const schema = date();
            const data = new Date("2023-01-15T12:30:00.000Z");

            const buffer = await serializeToBuffer(schema, data);
            const result = await deserializeFromBuffer<Date>(schema, buffer);

            expect(result).toEqual(data);
            expect(result.getTime()).toBe(data.getTime());
        });

        it("should throw ValidationError for non-date values", () => {
            const schema = date();
            expect(() => schema.validateAndMakeWriter("2023-01-15")).toThrow(
                ValidationError,
            );
            expect(() => schema.validateAndMakeWriter(1673784600000)).toThrow(
                ValidationError,
            );
        });
    });
});
