import { describe, it, expect } from "vitest";
import {
    promise,
    iterator,
    readableStream,
    string,
    uint,
    SerializableError,
    ValidationError,
} from "../schemas";

describe("Streaming Schema Types - Validation", () => {
    describe("promise", () => {
        it("should validate Promise objects", () => {
            const schema = promise(string());
            const validData = Promise.resolve("hello");

            // Should not throw for valid Promise
            expect(() =>
                schema.validateAndMakeWriter(validData),
            ).not.toThrow();
        });

        it("should throw ValidationError for non-Promise values", () => {
            const schema = promise(string());

            expect(() => schema.validateAndMakeWriter("not a promise")).toThrow(
                ValidationError,
            );
            expect(() => schema.validateAndMakeWriter(123)).toThrow(
                ValidationError,
            );
            expect(() => schema.validateAndMakeWriter({ then: "fake" })).toThrow(
                ValidationError,
            );
        });

        it("should accept different inner schemas", () => {
            const stringSchema = promise(string());
            const uintSchema = promise(uint());

            expect(() =>
                stringSchema.validateAndMakeWriter(Promise.resolve("test")),
            ).not.toThrow();
            expect(() =>
                uintSchema.validateAndMakeWriter(Promise.resolve(42)),
            ).not.toThrow();
        });
    });

    describe("iterator", () => {
        it("should validate iterable objects", () => {
            const schema = iterator(uint());
            const arrayData = [1, 2, 3];

            // Arrays are iterable, should not throw
            expect(() => schema.validateAndMakeWriter(arrayData)).not.toThrow();
        });

        it("should validate generator functions", () => {
            const schema = iterator(string());

            function* generator() {
                yield "first";
                yield "second";
            }

            const data = generator();
            expect(() => schema.validateAndMakeWriter(data)).not.toThrow();
        });

        it("should validate async iterables", () => {
            const schema = iterator(string());

            async function* asyncGen() {
                yield "first";
                yield "second";
            }

            const data = asyncGen();
            expect(() => schema.validateAndMakeWriter(data)).not.toThrow();
        });

        it("should throw ValidationError for non-iterable values", () => {
            const schema = iterator(uint());

            expect(() => schema.validateAndMakeWriter("not iterable")).toThrow(
                ValidationError,
            );
            expect(() => schema.validateAndMakeWriter(123)).toThrow(
                ValidationError,
            );
            expect(() => schema.validateAndMakeWriter(null)).toThrow(
                ValidationError,
            );
        });

        it("should throw ValidationError for objects without iterator symbols", () => {
            const schema = iterator(uint());
            const notIterable = { a: 1, b: 2 };

            expect(() => schema.validateAndMakeWriter(notIterable)).toThrow(
                ValidationError,
            );
        });
    });

    describe("readableStream", () => {
        it("should validate ReadableStream objects", () => {
            const schema = readableStream();
            const data = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new Uint8Array([1, 2, 3]));
                    controller.close();
                },
            });

            expect(() => schema.validateAndMakeWriter(data)).not.toThrow();
        });

        it("should throw ValidationError for non-ReadableStream values", () => {
            const schema = readableStream();

            expect(() =>
                schema.validateAndMakeWriter("not a stream"),
            ).toThrow(ValidationError);
            expect(() => schema.validateAndMakeWriter([])).toThrow(
                ValidationError,
            );
            expect(() => schema.validateAndMakeWriter(null)).toThrow(
                ValidationError,
            );
        });
    });

    describe("SerializableError", () => {
        it("should create SerializableError with schema and data", () => {
            const errorSchema = string();
            const errorData = "error message";
            const error = new SerializableError(errorSchema, errorData);

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(SerializableError);
            expect(error.schema).toBe(errorSchema);
            expect(error.data).toBe(errorData);
            expect(error.name).toBe("SerializableError");
            expect(error.message).toBe("SerializableError");
        });

        it("should work with different data types", () => {
            const uintSchema = uint();
            const error1 = new SerializableError(uintSchema, 404);

            expect(error1.data).toBe(404);
            expect(error1.schema).toBe(uintSchema);
        });
    });
});
