import { OutOfDataError } from "./ReadContext";
import { dataType, readRollingUintNoAlloc, WriteContext } from "./utils";
import FlatPromiseStream from "./FlatPromiseStream";
import type { output } from "./deserialize";
import type { ReadContext } from "./ReadContext";

function base<T>(
    name: string,
    validateAndMakeWriter: (
        data: unknown,

        // This can't be in the write context because it is needed when
        // we figure out the size of the data to write.
        scratchPad: { [key: symbol]: any },
    ) => [number, (ctx: WriteContext) => void],
    readFromContext: (
        ctx: ReadContext,
        hijackReadContext: (
            id: number,
            cb: (ctx: ReadContext) => Promise<void>,
            onDisconnect: () => void,
        ) => (slurp: boolean) => void,
        scratchPad: { [key: symbol]: any },
    ) => Promise<[T]>,
    schema: Uint8Array<ArrayBuffer>,
) {
    return {
        name,
        validateAndMakeWriter,
        readFromContext,
        schema,
    } as const;
}

/**
 * Core schema type that defines how data of type T should be serialized and deserialized.
 * All schema functions return this type, providing validation, serialization, and deserialization capabilities.
 *
 * @template T - The TypeScript type that this schema validates and handles
 */
export type Schema<T> = ReturnType<typeof base<T>>;

function getRollingUintSize(data: number) {
    if (data < 0) throw new Error("Data must be a non-negative integer");

    if (data < 0xfd) return 1;
    if (data <= 0xffff) return 3;
    if (data <= 0xffffffff) return 5;
    return 9;
}

function getEncodedLenNoAlloc(t: string) {
    let len = 0;
    for (let i = 0; i < t.length; i++) {
        const code = t.charCodeAt(i);
        if (code < 0x80) {
            len += 1;
        } else if (code < 0x800) {
            len += 2;
        } else if (code < 0xd800 || code >= 0xe000) {
            len += 3;
        } else {
            i++;
            len += 4;
        }
    }
    return len;
}

/**
 * Creates a schema that transforms input data before validation and serialization.
 * Useful for preprocessing data or applying transformations while maintaining type safety.
 *
 * @template T - The type handled by both the source schema and transformation
 * @param from - The base schema to use for validation and serialization
 * @param into - Transformation function applied to data before validation
 * @returns A new schema that applies the transformation before processing
 *
 * @example
 * ```typescript
 * const trimmedString = pipe(string(), (str) => str.trim());
 * ```
 */
export function pipe<T>(from: Schema<T>, into: (data: T) => T): Schema<T> {
    return {
        name: "pipe",
        validateAndMakeWriter: (data, scratchPad) => {
            // Run at the beginning to make sure the type is correct before
            from.validateAndMakeWriter(data, {}); // Intentionally empty scratchPad so we don't add to any tables
            data = into(data as T);
            return from.validateAndMakeWriter(data, scratchPad);
        },
        readFromContext: from.readFromContext,
        schema: from.schema,
    } as const;
}

/**
 * Error thrown when data validation fails during schema processing.
 * Contains a descriptive message about what validation rule was violated.
 */
export class ValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ValidationError";
    }
}

function writeRollingUintNoAlloc(data: number, u8a: Uint8Array, pos: number) {
    if (data < 0) throw new Error("Data must be a non-negative integer");

    if (data < 0xfd) {
        u8a[pos] = data;
        return pos + 1;
    }
    if (data <= 0xffff) {
        u8a[pos] = 0xfd;
        u8a[pos + 1] = data & 0xff;
        u8a[pos + 2] = (data >> 8) & 0xff;
        return pos + 3;
    }
    if (data <= 0xffffffff) {
        u8a[pos] = 0xfe;
        u8a[pos + 1] = data & 0xff;
        u8a[pos + 2] = (data >> 8) & 0xff;
        u8a[pos + 3] = (data >> 16) & 0xff;
        u8a[pos + 4] = (data >> 24) & 0xff;
        return pos + 5;
    }
    u8a[pos] = 0xff;
    u8a[pos + 1] = data & 0xff;
    u8a[pos + 2] = (data >> 8) & 0xff;
    u8a[pos + 3] = (data >> 16) & 0xff;
    u8a[pos + 4] = (data >> 24) & 0xff;
    u8a[pos + 5] = (data >> 32) & 0xff;
    u8a[pos + 6] = (data >> 40) & 0xff;
    u8a[pos + 7] = (data >> 48) & 0xff;
    u8a[pos + 8] = (data >> 56) & 0xff;
    return pos + 9;
}

/**
 * Creates a schema for arrays containing elements of a specific type.
 * Validates that data is an array and that all elements conform to the element schema.
 *
 * @template T - The type of elements in the array
 * @param elements - Schema defining the structure of array elements
 * @param message - Optional custom validation error message
 * @returns Schema for arrays of type T[]
 *
 * @example
 * ```typescript
 * const numberArray = array(uint());
 * const stringArray = array(string());
 * ```
 */
export function array<T>(elements: Schema<T>, message?: string) {
    if (!message) message = "Data must be an array";

    const schema = new Uint8Array([dataType.array, ...elements.schema]);

    return base<T[]>(
        "array",
        (data, scratchPad) => {
            if (!Array.isArray(data)) throw new ValidationError(message);
            let size = getRollingUintSize(data.length);
            const writers: ((ctx: WriteContext) => void)[] = [];
            for (const item of data) {
                const [s, writer] = elements.validateAndMakeWriter(
                    item,
                    scratchPad,
                );
                size += s;
                writers.push(writer);
            }
            return [
                size,
                (ctx: WriteContext) => {
                    ctx.pos = writeRollingUintNoAlloc(
                        data.length,
                        ctx.buf,
                        ctx.pos,
                    );
                    for (const writer of writers) {
                        writer(ctx);
                    }
                },
            ];
        },
        async (ctx, hijackReadContext, scratchPad) => {
            const len = await readRollingUintNoAlloc(ctx);
            const res: T[] = [];
            for (let i = 0; i < len; i++) {
                const item = await elements.readFromContext(
                    ctx,
                    hijackReadContext,
                    scratchPad,
                );
                res.push(item[0]);
            }
            return [res];
        },
        schema,
    );
}

/**
 * Type definition for object schemas - a mapping from string keys to schema definitions.
 * Used as input to the object() schema function to define object structure.
 */
export type ObjectSchemas = {
    [key: string]: Schema<any>;
};

const te = new TextEncoder();

/**
 * Creates a schema for objects with predefined properties and their schemas.
 * Validates that data is an object and that all properties conform to their defined schemas.
 * Properties are processed in alphabetical order for consistent serialization.
 *
 * @template T - Object schema definition mapping property names to schemas
 * @param schemas - Object defining the schema for each property
 * @param message - Optional custom validation error message
 * @returns Schema for objects with the specified structure
 *
 * @example
 * ```typescript
 * const userSchema = object({
 *   name: string(),
 *   age: uint(),
 *   email: optional(string())
 * });
 * ```
 */
export function object<T extends ObjectSchemas>(schemas: T, message?: string) {
    if (!message) message = "Data must be an object";

    const keys = Object.keys(schemas).sort((a, b) => a.localeCompare(b));
    let schemaLen = 1 + getRollingUintSize(keys.length); // 1 byte for dataType, plus key count
    for (const key of keys) {
        schemaLen += getRollingUintSize(key.length) + key.length;
    }

    const schemaParts: Uint8Array[] = keys.map((key) => {
        schemaLen += schemas[key].schema.length;
        return schemas[key].schema;
    });

    const schema = new Uint8Array(schemaLen);
    schema[0] = dataType.object;
    let pos = writeRollingUintNoAlloc(keys.length, schema, 1);
    for (let i = 0; i < keys.length; i++) {
        // Write key
        const key = keys[i];
        const keyLen = getEncodedLenNoAlloc(key);
        pos = writeRollingUintNoAlloc(key.length, schema, pos);
        te.encodeInto(key, schema.subarray(pos, pos + keyLen));
        pos += keyLen;

        // Write schema part
        const part = schemaParts[i];
        schema.set(part, pos);
        pos += part.length;
    }

    type Resolved = {
        [K in keyof T]: T[K] extends Schema<infer U> ? U : never;
    };

    return base<Resolved>(
        "object",
        (data, scratchPad) => {
            if (
                typeof data !== "object" ||
                data === null ||
                Array.isArray(data)
            ) {
                throw new ValidationError(message);
            }
            let size = 0;
            const writers: ((ctx: WriteContext) => void)[] = [];
            for (const key of keys) {
                const [s, writer] = schemas[key].validateAndMakeWriter(
                    (data as any)[key],
                    scratchPad,
                );
                size += s;
                writers.push(writer);
            }
            return [
                size,
                (ctx: WriteContext) => {
                    for (const writer of writers) {
                        writer(ctx);
                    }
                },
            ];
        },
        async (ctx, hijackReadContext, scratchPad) => {
            const res: any = {};
            for (const key of keys) {
                const value = await schemas[key].readFromContext(
                    ctx,
                    hijackReadContext,
                    scratchPad,
                );
                res[key] = value[0];
            }
            return [res as Resolved];
        },
        schema,
    );
}

const td = new TextDecoder();

/**
 * Creates a schema for UTF-8 encoded strings.
 * Validates that data is a string and handles efficient UTF-8 encoding/decoding.
 *
 * @param message - Optional custom validation error message
 * @returns Schema for string values
 *
 * @example
 * ```typescript
 * const nameSchema = string("Name must be a string");
 * ```
 */
export function string(message?: string) {
    if (!message) message = "Data must be a string";
    return base<string>(
        "string",
        (data) => {
            if (typeof data !== "string") throw new ValidationError(message);
            const len = getEncodedLenNoAlloc(data);
            return [
                getRollingUintSize(len) + len,
                (ctx: WriteContext) => {
                    ctx.pos = writeRollingUintNoAlloc(len, ctx.buf, ctx.pos);
                    te.encodeInto(
                        data,
                        ctx.buf.subarray(ctx.pos, ctx.pos + len),
                    );
                    ctx.pos += len;
                },
            ];
        },
        async (ctx) => {
            const len = await readRollingUintNoAlloc(ctx);
            const bytes = await ctx.readBytes(len);

            return [td.decode(bytes)];
        },
        new Uint8Array([dataType.string]),
    );
}

/**
 * Creates a schema for Uint8Array binary data.
 * Validates that data is a Uint8Array and handles efficient binary serialization.
 *
 * @param message - Optional custom validation error message
 * @returns Schema for Uint8Array values
 *
 * @example
 * ```typescript
 * const binaryData = uint8array("Expected binary data");
 * ```
 */
export function uint8array(message?: string) {
    if (!message) message = "Data must be a Uint8Array";
    return base<Uint8Array>(
        "uint8array",
        (data) => {
            if (!(data instanceof Uint8Array))
                throw new ValidationError(message);
            const len = data.length;
            return [
                getRollingUintSize(len) + len,
                (ctx: WriteContext) => {
                    const len = data.length;
                    ctx.pos = writeRollingUintNoAlloc(len, ctx.buf, ctx.pos);
                    ctx.buf.set(data, ctx.pos);
                    ctx.pos += len;
                },
            ];
        },
        async (ctx) => {
            const len = await readRollingUintNoAlloc(ctx);
            const bytes = await ctx.readBytes(len);
            return [bytes];
        },
        new Uint8Array([dataType.u8array]),
    );
}

/**
 * Creates a schema for Node.js Buffer objects.
 * Validates that data is a Buffer and handles efficient binary serialization.
 * Note: This is Node.js specific and may not work in browser environments.
 *
 * @param message - Optional custom validation error message
 * @returns Schema for Buffer values
 *
 * @example
 * ```typescript
 * const fileData = buffer("Expected buffer data");
 * ```
 */
export function buffer(message?: string) {
    if (!message) message = "Data must be a Buffer";
    return base<Buffer>(
        "buffer",
        (data) => {
            if (!Buffer.isBuffer(data)) throw new ValidationError(message);
            const len = data.length;
            return [
                getRollingUintSize(len) + len,
                (ctx: WriteContext) => {
                    const len = data.length;
                    ctx.pos = writeRollingUintNoAlloc(len, ctx.buf, ctx.pos);
                    ctx.buf.set(data, ctx.pos);
                    ctx.pos += len;
                },
            ];
        },
        async (ctx) => {
            const len = await readRollingUintNoAlloc(ctx);
            const bytes = await ctx.readBytes(len);
            return [Buffer.from(bytes)];
        },
        new Uint8Array([dataType.buffer]),
    );
}

/**
 * Special error class for errors that can be serialized across the stream.
 * Contains both the schema definition and the error data, allowing the error
 * to be reconstructed on the receiving side.
 *
 * @template T - The type of the error data
 */
export class SerializableError<T> extends Error {
    constructor(
        public schema: Schema<T>,
        public data: T,
    ) {
        super("SerializableError");
        this.name = "SerializableError";
    }
}

/**
 * Creates a schema for Promise objects that resolve to a specific type.
 * Handles asynchronous data by creating a stream for the promise resolution.
 * Supports both successful resolution and SerializableError rejection.
 *
 * @template T - The type that the promise resolves to
 * @param inner - Schema for the resolved value
 * @param message - Optional custom validation error message
 * @returns Schema for Promise<T> values
 *
 * @example
 * ```typescript
 * const asyncString = promise(string());
 * const asyncUser = promise(object({ name: string(), age: uint() }));
 * ```
 */
export function promise<T>(inner: Schema<T>, message?: string) {
    if (!message) message = "Data must be a Promise";

    const schema = new Uint8Array([dataType.promise, ...inner.schema]);

    return base<Promise<T>>(
        "promise",
        (data, scratchPad) => {
            if (!(data instanceof Promise)) throw new ValidationError(message);

            return [
                2,
                (ctx: WriteContext) => {
                    const [id, writer] = ctx.createWriteStream();
                    ctx.buf[ctx.pos] = (id >> 8) & 0xff;
                    ctx.buf[ctx.pos + 1] = id & 0xff;
                    ctx.pos += 2;
                    data.then((value) => {
                        const [size, ctxWriter] = inner.validateAndMakeWriter(
                            value,
                            scratchPad,
                        );
                        const buf = new Uint8Array(1 + size); // 1 byte for success flag
                        buf[0] = 1; // success
                        const writeCtx: WriteContext = {
                            buf,
                            pos: 1,
                            createWriteStream: ctx.createWriteStream,
                        };
                        ctxWriter(writeCtx);
                        writer(buf);
                        writer(null);
                    }).catch((err) => {
                        if (err instanceof SerializableError) {
                            // Get the size of the serialized error data
                            const [size, ctxWriter] =
                                err.schema.validateAndMakeWriter(
                                    err.data,
                                    scratchPad,
                                );
                            const buf = new Uint8Array(
                                1 + err.schema.schema.length + size,
                            );
                            buf[0] = 0; // failure
                            buf.set(err.schema.schema, 1);
                            const writeCtx: WriteContext = {
                                buf,
                                pos: 1 + err.schema.schema.length,
                                createWriteStream: ctx.createWriteStream,
                            };
                            ctxWriter(writeCtx);
                            writer(buf);
                            writer(null);
                            return;
                        }

                        throw err;
                    });
                },
            ];
        },
        async (ctx, hijackReadContext, scratchPad) => {
            const idHigh = await ctx.readByte();
            const idLow = await ctx.readByte();
            const id = (idHigh << 8) | idLow;

            let cleanup: (slurp: boolean) => void;
            const promise = new Promise<T>((resolve, reject) => {
                cleanup = hijackReadContext(
                    id,
                    async (streamCtx) => {
                        try {
                            const flag = await streamCtx.readByte();
                            if (flag === 1) {
                                // success
                                const value = await inner.readFromContext(
                                    streamCtx,
                                    hijackReadContext,
                                    scratchPad,
                                );
                                resolve(value[0]);
                                return;
                            }

                            if (flag === 0) {
                                // failure
                                const { reflectByteReprToSchema } =
                                    await import("./reflection");
                                const errorSchema =
                                    await reflectByteReprToSchema(streamCtx);
                                const errorData =
                                    await errorSchema.readFromContext(
                                        streamCtx,
                                        hijackReadContext,
                                        scratchPad,
                                    );
                                reject(
                                    new SerializableError(
                                        errorSchema,
                                        errorData[0],
                                    ),
                                );
                                return;
                            }

                            reject(
                                new Error(
                                    "internal: Invalid promise resolution flag",
                                ),
                            );
                        } catch (err) {
                            reject(err);
                        } finally {
                            cleanup(false);
                        }
                    },
                    () => {
                        reject(new OutOfDataError());
                    },
                );
            });
            const finalizer = new FinalizationRegistry(() => {
                cleanup(true);
            });
            finalizer.register(promise, id);
            return [promise] as [Promise<T>];
        },
        schema,
    );
}

const done_ = Symbol("done");

/**
 * Creates a schema for iterables (both sync and async) that yield elements of a specific type.
 * Handles streaming of iterable data, supporting both Iterable<T> and AsyncIterable<T>.
 * The iterator is consumed lazily and elements are streamed as they become available.
 *
 * @template T - The type of elements yielded by the iterator
 * @param elements - Schema for individual elements
 * @param message - Optional custom validation error message
 * @returns Schema for Iterable<T> or AsyncIterable<T> values
 *
 * @example
 * ```typescript
 * const numberStream = iterator(uint());
 * const stringStream = iterator(string());
 * ```
 */
export function iterator<T>(elements: Schema<T>, message?: string) {
    if (!message) message = "Data must be an iterator";

    const schema = new Uint8Array([dataType.iterator, ...elements.schema]);

    return base<Iterable<T> | AsyncIterable<T>>(
        "iterator",
        (data, scratchPad) => {
            if (
                typeof data !== "object" ||
                data === null ||
                (!(data as any)[Symbol.iterator] &&
                    !(data as any)[Symbol.asyncIterator])
            ) {
                throw new ValidationError(message);
            }
            return [
                2,
                (ctx: WriteContext) => {
                    const [id, writer] = ctx.createWriteStream();
                    ctx.buf[ctx.pos] = (id >> 8) & 0xff;
                    ctx.buf[ctx.pos + 1] = id & 0xff;
                    ctx.pos += 2;
                    (async () => {
                        try {
                            for await (const item of data as any) {
                                const [size, ctxWriter] =
                                    elements.validateAndMakeWriter(
                                        item,
                                        scratchPad,
                                    );
                                const buf = new Uint8Array(1 + size); // 1 byte for continuation flag
                                buf[0] = 1; // continuation
                                const writeCtx: WriteContext = {
                                    buf,
                                    pos: 1,
                                    createWriteStream: ctx.createWriteStream,
                                };
                                ctxWriter(writeCtx);
                                writer(buf);
                            }
                            const buf = new Uint8Array(1);
                            writer(buf);
                            writer(null);
                        } catch (err) {
                            if (err instanceof SerializableError) {
                                // Get the size of the serialized error data
                                const [size, ctxWriter] =
                                    err.schema.validateAndMakeWriter(
                                        err.data,
                                        scratchPad,
                                    );
                                const buf = new Uint8Array(
                                    1 + err.schema.schema.length + size,
                                );
                                buf[0] = 2; // error flag
                                buf.set(err.schema.schema, 1);
                                const writeCtx: WriteContext = {
                                    buf,
                                    pos: 1 + err.schema.schema.length,
                                    createWriteStream: ctx.createWriteStream,
                                };
                                ctxWriter(writeCtx);
                                writer(buf);
                                writer(null);
                                return;
                            }

                            throw err;
                        }
                    })();
                },
            ];
        },
        async (ctx, hijackReadContext, scratchPad) => {
            const idHigh = await ctx.readByte();
            const idLow = await ctx.readByte();
            const id = (idHigh << 8) | idLow;

            const promiseStream = new FlatPromiseStream<T | typeof done_>();
            let cleanup: (slurp: boolean) => void;
            cleanup = hijackReadContext(
                id,
                async (streamCtx) => {
                    try {
                        const flag = await streamCtx.readByte();
                        if (flag === 1) {
                            // continuation
                            const value = await elements.readFromContext(
                                streamCtx,
                                hijackReadContext,
                                scratchPad,
                            );
                            promiseStream.resolve(value[0]);
                            return;
                        }

                        if (flag === 0) {
                            // end of iterator
                            promiseStream.resolve(done_);
                            cleanup(false);
                            return;
                        }

                        if (flag === 2) {
                            // error
                            const { reflectByteReprToSchema } = await import(
                                "./reflection"
                            );
                            const errorSchema =
                                await reflectByteReprToSchema(streamCtx);
                            const errorData = await errorSchema.readFromContext(
                                streamCtx,
                                hijackReadContext,
                                scratchPad,
                            );
                            promiseStream.reject(
                                new SerializableError(
                                    errorSchema,
                                    errorData[0],
                                ),
                            );
                            cleanup(false);
                            return;
                        }

                        throw new Error("internal: Invalid iterator flag");
                    } catch (err) {
                        promiseStream.reject(err);
                        cleanup(false);
                    }
                },
                () => {
                    promiseStream.reject(new OutOfDataError());
                },
            );

            const finalizer = new FinalizationRegistry(() => {
                cleanup(true);
            });
            const asyncIterable: AsyncIterable<T> = {
                async *[Symbol.asyncIterator]() {
                    for (;;) {
                        const value = await promiseStream;
                        if (value === done_) {
                            return;
                        }
                        yield value as T;
                    }
                },
            };
            finalizer.register(asyncIterable, id);
            return [asyncIterable] as [Iterable<T> | AsyncIterable<T>];
        },
        schema,
    );
}

/**
 * Creates a schema for boolean values (true/false).
 * Validates that data is a boolean and encodes it efficiently as a single byte.
 *
 * @param message - Optional custom validation error message
 * @returns Schema for boolean values
 *
 * @example
 * ```typescript
 * const isActive = boolean("Must be true or false");
 * ```
 */
export function boolean(message?: string) {
    if (!message) message = "Data must be a boolean";
    return base<boolean>(
        "boolean",
        (data) => {
            if (typeof data !== "boolean") throw new ValidationError(message);
            return [
                1,
                (ctx: WriteContext) => {
                    ctx.buf[ctx.pos] = data ? 1 : 0;
                    ctx.pos += 1;
                },
            ];
        },
        async (ctx) => {
            const byte = await ctx.readByte();
            if (byte === 0) return [false];
            if (byte === 1) return [true];
            throw new Error("internal: Invalid boolean value");
        },
        new Uint8Array([dataType.boolean]),
    );
}

/**
 * Creates a schema for unsigned 8-bit integers (0-255).
 * Validates that data is an integer within the uint8 range and encodes it as a single byte.
 *
 * @param message - Optional custom validation error message
 * @returns Schema for uint8 values
 *
 * @example
 * ```typescript
 * const colorComponent = uint8("Color component must be 0-255");
 * ```
 */
export function uint8(message?: string) {
    if (!message) message = "Data must be a uint8";
    return base<number>(
        "uint8",
        (data) => {
            if (
                typeof data !== "number" ||
                !Number.isInteger(data) ||
                data < 0 ||
                data > 255
            ) {
                throw new ValidationError(message);
            }
            return [
                1,
                (ctx: WriteContext) => {
                    ctx.buf[ctx.pos] = data;
                    ctx.pos += 1;
                },
            ];
        },
        async (ctx) => {
            const byte = await ctx.readByte();
            return [byte];
        },
        new Uint8Array([dataType.uint8]),
    );
}

/**
 * Creates a schema for unsigned integers (non-negative integers).
 * Uses variable-length encoding to efficiently store small numbers in fewer bytes.
 * Supports values from 0 to 2^53-1 (JavaScript's safe integer limit).
 *
 * @param message - Optional custom validation error message
 * @returns Schema for unsigned integer values
 *
 * @example
 * ```typescript
 * const count = uint("Count must be a non-negative integer");
 * const id = uint();
 * ```
 */
export function uint(message?: string) {
    if (!message) message = "Data must be a uint";
    return base<number>(
        "uint",
        (data) => {
            if (
                typeof data !== "number" ||
                !Number.isInteger(data) ||
                data < 0
            ) {
                throw new ValidationError(message);
            }
            return [
                getRollingUintSize(data),
                (ctx: WriteContext) => {
                    ctx.pos = writeRollingUintNoAlloc(data, ctx.buf, ctx.pos);
                },
            ];
        },
        async (ctx) => {
            const value = await readRollingUintNoAlloc(ctx);
            return [value];
        },
        new Uint8Array([dataType.uint]),
    );
}

/**
 * Creates a schema for union types that can match one of several possible schemas.
 * Attempts to validate against each schema in order until one succeeds.
 * The first matching schema is used for serialization/deserialization.
 *
 * @template Schema1 - The first schema type
 * @template OtherSchemas - Array of additional schema types
 * @param first - The first schema to try
 * @param others - Additional schemas to try if the first fails
 * @returns Schema for union of all provided schema types
 *
 * @example
 * ```typescript
 * const stringOrNumber = union(string(), uint());
 * const result = union(
 *   object({ type: "user", name: string() }),
 *   object({ type: "admin", permissions: array(string()) })
 * );
 * ```
 */
export function union<
    Schema1 extends Schema<any>,
    OtherSchemas extends Schema<any>[],
>(first: Schema1, ...others: OtherSchemas) {
    others.unshift(first);

    let schemaLen = 1 + getRollingUintSize(others.length - 1); // 1 byte for dataType, plus index size
    for (const sch of others) {
        schemaLen += sch.schema.length;
    }

    const schema = new Uint8Array(schemaLen);
    schema[0] = dataType.union;
    let pos = writeRollingUintNoAlloc(others.length - 1, schema, 1);
    for (const sch of others) {
        schema.set(sch.schema, pos);
        pos += sch.schema.length;
    }

    return base<
        Schema1 extends Schema<infer U1>
            ? OtherSchemas extends Schema<infer U2>[]
                ? U1 | U2
                : never
            : never
    >(
        "union",
        (data, scratchPad) => {
            const errors: ValidationError[] = [];
            let idx = -1;
            for (let i = 0; i < others.length; i++) {
                try {
                    others[i].validateAndMakeWriter(data, {});
                    idx = i;
                    break;
                } catch (err) {
                    if (err instanceof ValidationError) {
                        errors.push(err);
                    } else {
                        throw err;
                    }
                }
            }
            if (idx === -1) {
                // If we reach here, none matched.
                throw new ValidationError(
                    `Data did not match any schema in union: ${errors.map((e) => e.message).join("; ")}`,
                );
            }
            const [size, writer] = others[idx].validateAndMakeWriter(
                data,
                scratchPad,
            );
            return [
                getRollingUintSize(idx) + size,
                (ctx: WriteContext) => {
                    ctx.pos = writeRollingUintNoAlloc(idx, ctx.buf, ctx.pos);
                    writer(ctx);
                },
            ];
        },
        async (ctx, hijackReadContext, scratchPad) => {
            const index = await readRollingUintNoAlloc(ctx);
            if (index < 0 || index >= others.length) {
                throw new Error("internal: Invalid union schema index");
            }
            const value = await others[index].readFromContext(
                ctx,
                hijackReadContext,
                scratchPad,
            );
            return value as any;
        },
        schema,
    );
}

/**
 * Creates a schema for Date objects.
 * Validates that data is a Date instance and serializes it as an ISO string.
 * Preserves full date/time precision including milliseconds and timezone.
 *
 * @param message - Optional custom validation error message
 * @returns Schema for Date values
 *
 * @example
 * ```typescript
 * const timestamp = date("Expected a valid date");
 * const createdAt = date();
 * ```
 */
export function date(message?: string) {
    if (!message) message = "Data must be a Date";

    return base<Date>(
        "date",
        (data) => {
            if (!(data instanceof Date)) throw new ValidationError(message);
            const timeStr = data.toISOString();
            const len = getEncodedLenNoAlloc(timeStr);
            return [
                getRollingUintSize(len) + len,
                (ctx: WriteContext) => {
                    ctx.pos = writeRollingUintNoAlloc(len, ctx.buf, ctx.pos);
                    te.encodeInto(
                        timeStr,
                        ctx.buf.subarray(ctx.pos, ctx.pos + len),
                    );
                    ctx.pos += len;
                },
            ];
        },
        async (ctx) => {
            const len = await readRollingUintNoAlloc(ctx);
            const bytes = await ctx.readBytes(len);
            const timeStr = td.decode(bytes);
            return [new Date(timeStr)];
        },
        new Uint8Array([dataType.date]),
    );
}

/**
 * Creates a schema for signed integers (positive and negative integers).
 * Uses zigzag encoding to efficiently represent both positive and negative numbers.
 * Supports the full range of JavaScript safe integers.
 *
 * @param message - Optional custom validation error message
 * @returns Schema for signed integer values
 *
 * @example
 * ```typescript
 * const temperature = int("Temperature must be an integer");
 * const delta = int();
 * ```
 */
export function int(message?: string) {
    if (!message) message = "Data must be an int";
    return base<number>(
        "int",
        (data) => {
            if (typeof data !== "number" || !Number.isInteger(data)) {
                throw new ValidationError(message);
            }
            // Zigzag encoding
            const zigzagged = (data << 1) ^ (data >> 31);
            return [
                getRollingUintSize(zigzagged),
                (ctx: WriteContext) => {
                    ctx.pos = writeRollingUintNoAlloc(
                        zigzagged,
                        ctx.buf,
                        ctx.pos,
                    );
                },
            ];
        },
        async (ctx) => {
            const zigzagged = await readRollingUintNoAlloc(ctx);
            // Decode zigzag encoding
            const value = (zigzagged >>> 1) ^ -(zigzagged & 1);
            return [value];
        },
        new Uint8Array([dataType.int]),
    );
}

/**
 * Creates a schema for floating-point numbers (including integers as floats).
 * Uses IEEE 754 double precision (64-bit) encoding for full precision.
 * Accepts any JavaScript number including Infinity, -Infinity, and NaN.
 *
 * @param message - Optional custom validation error message
 * @returns Schema for floating-point number values
 *
 * @example
 * ```typescript
 * const price = float("Price must be a number");
 * const ratio = float();
 * ```
 */
export function float(message?: string) {
    if (!message) message = "Data must be a float";
    return base<number>(
        "float",
        (data) => {
            if (typeof data !== "number") {
                throw new ValidationError(message);
            }
            return [
                8,
                (ctx: WriteContext) => {
                    const view = new DataView(
                        ctx.buf.buffer,
                        ctx.buf.byteOffset + ctx.pos,
                        8,
                    );
                    view.setFloat64(0, data, true);
                    ctx.pos += 8;
                },
            ];
        },
        async (ctx) => {
            const bytes = await ctx.readBytes(8);
            const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
            const value = view.getFloat64(0, true);
            return [value];
        },
        new Uint8Array([dataType.float]),
    );
}

/**
 * Creates a schema for nullable values (T | null).
 * If no inner schema is provided, only accepts null values.
 * If an inner schema is provided, accepts either null or values matching the inner schema.
 *
 * @template T - The type of non-null values (defaults to null if no inner schema)
 * @param inner - Optional schema for non-null values
 * @returns Schema for T | null values
 *
 * @example
 * ```typescript
 * const optionalString = nullable(string());
 * const nullOnly = nullable(); // Only accepts null
 * ```
 */
export function nullable<T = null>(inner?: Schema<T>) {
    return base<T | null>(
        "nullable",
        (data, scratchPad) => {
            if (data === null) {
                return [
                    1,
                    (ctx: WriteContext) => {
                        ctx.buf[ctx.pos] = 0;
                        ctx.pos += 1;
                    },
                ];
            }
            if (!inner) {
                throw new ValidationError(
                    "Data must be null (no inner schema provided)",
                );
            }
            const [size, writer] = inner.validateAndMakeWriter(
                data,
                scratchPad,
            );
            return [
                1 + size,
                (ctx: WriteContext) => {
                    ctx.buf[ctx.pos] = 1;
                    ctx.pos += 1;
                    writer(ctx);
                },
            ];
        },
        async (ctx, hijackReadContext, scratchPad) => {
            const flag = await ctx.readByte();
            if (flag === 0) {
                return [null];
            }
            if (flag === 1) {
                if (!inner) {
                    throw new Error(
                        "internal: No inner schema provided for nullable",
                    );
                }
                const value = await inner.readFromContext(
                    ctx,
                    hijackReadContext,
                    scratchPad,
                );
                return value as [T];
            }
            throw new Error("internal: Invalid nullable flag");
        },
        inner
            ? new Uint8Array([dataType.nullable, ...inner.schema])
            : new Uint8Array([dataType.nullable, 0x00]), // special case because we need to know if no schema
    );
}

/**
 * Creates a schema for optional values (T | undefined).
 * Accepts either undefined or values matching the inner schema.
 * Useful for object properties that may not be present.
 *
 * @template T - The type of defined values
 * @param inner - Schema for defined values
 * @returns Schema for T | undefined values
 *
 * @example
 * ```typescript
 * const optionalAge = optional(uint());
 * const maybeEmail = optional(string());
 * ```
 */
export function optional<T>(inner: Schema<T>) {
    return base<T | undefined>(
        "optional",
        (data, scratchPad) => {
            if (data === undefined) {
                return [
                    1,
                    (ctx: WriteContext) => {
                        ctx.buf[ctx.pos] = 0;
                        ctx.pos += 1;
                    },
                ];
            }
            const [size, writer] = inner.validateAndMakeWriter(
                data,
                scratchPad,
            );
            return [
                1 + size,
                (ctx: WriteContext) => {
                    ctx.buf[ctx.pos] = 1;
                    ctx.pos += 1;
                    writer(ctx);
                },
            ];
        },
        async (ctx, hijackReadContext, scratchPad) => {
            const flag = await ctx.readByte();
            if (flag === 0) {
                return [undefined];
            }
            if (flag === 1) {
                const value = await inner.readFromContext(
                    ctx,
                    hijackReadContext,
                    scratchPad,
                );
                return value as [T];
            }
            throw new Error("internal: Invalid optional flag");
        },
        new Uint8Array([dataType.optional, ...inner.schema]),
    );
}

/**
 * Creates a schema for BigInt values.
 * Validates that data is a bigint and serializes it as a 64-bit unsigned integer.
 * Supports values from 0 to 2^64-1.
 *
 * @param message - Optional custom validation error message
 * @returns Schema for bigint values
 *
 * @example
 * ```typescript
 * const largeNumber = bigint("Expected a bigint value");
 * const id = bigint();
 * ```
 */
export function bigint(message?: string) {
    if (!message) message = "Data must be a bigint";
    return base<bigint>(
        "bigint",
        (data) => {
            if (typeof data !== "bigint") {
                throw new ValidationError(message);
            }
            return [
                8,
                (ctx: WriteContext) => {
                    const view = new DataView(
                        ctx.buf.buffer,
                        ctx.buf.byteOffset + ctx.pos,
                        8,
                    );
                    view.setBigUint64(0, data, true);
                    ctx.pos += 8;
                },
            ];
        },
        async (ctx) => {
            const bytes = await ctx.readBytes(8);
            const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
            const value = view.getBigUint64(0, true);
            return [value];
        },
        new Uint8Array([dataType.bigint]),
    );
}

/**
 * Creates a schema for ReadableStream<Uint8Array> objects.
 * Handles streaming binary data by creating a stream channel for the readable stream.
 * The stream is consumed and its chunks are forwarded through the serialization channel.
 *
 * @param message - Optional custom validation error message
 * @returns Schema for ReadableStream<Uint8Array> values
 *
 * @example
 * ```typescript
 * const fileStream = readableStream("Expected a readable stream");
 * const dataStream = readableStream();
 * ```
 */
export function readableStream(message?: string) {
    if (!message) message = "Data must be a ReadableStream";

    return base<ReadableStream<Uint8Array>>(
        "readableStream",
        (data) => {
            if (!(data instanceof ReadableStream)) {
                throw new ValidationError(message);
            }
            return [
                2,
                (ctx: WriteContext) => {
                    const [id, writer] = ctx.createWriteStream();
                    ctx.buf[ctx.pos] = (id >> 8) & 0xff;
                    ctx.buf[ctx.pos + 1] = id & 0xff;
                    ctx.pos += 2;
                    (async () => {
                        try {
                            const reader = data.getReader();
                            for (;;) {
                                const { done, value } = await reader.read();
                                if (done) {
                                    writer(new Uint8Array(1));
                                    writer(null);
                                    break;
                                }
                                if ((value as Uint8Array).length === 0) {
                                    continue;
                                }
                                const arr = new Uint8Array(
                                    getRollingUintSize(
                                        (value as Uint8Array).length,
                                    ) + (value as Uint8Array).length,
                                );
                                let pos = writeRollingUintNoAlloc(
                                    (value as Uint8Array).length,
                                    arr,
                                    0,
                                );
                                arr.set(value as Uint8Array, pos);
                                writer(arr);
                            }
                        } catch (err) {
                            throw err;
                        }
                    })();
                },
            ];
        },
        async (ctx, hijackReadContext) => {
            const idHigh = await ctx.readByte();
            const idLow = await ctx.readByte();
            const id = (idHigh << 8) | idLow;

            let cleanup: (slurp: boolean) => void;
            const stream = new ReadableStream<Uint8Array>({
                start: (controller) => {
                    cleanup = hijackReadContext(
                        id,
                        async (streamCtx) => {
                            try {
                                const len =
                                    await readRollingUintNoAlloc(streamCtx);
                                if (len === 0) {
                                    controller.close();
                                    cleanup(false);
                                    return;
                                }
                                const bytes = await streamCtx.readBytes(len);
                                controller.enqueue(bytes);
                            } catch (err) {
                                controller.error(err);
                                cleanup(false);
                            }
                        },
                        () => {
                            controller.error(new OutOfDataError());
                        },
                    );
                },
                cancel: () => {
                    cleanup(true);
                },
            });
            return [stream];
        },
        new Uint8Array([dataType.readableStream]),
    );
}

/**
 * Creates a schema for record objects (objects with string keys and values of a specific type).
 * Similar to object() but for dynamic key-value pairs where all values have the same schema.
 * Only includes enumerable own properties of the object.
 *
 * @template S - The schema type for values
 * @param child - Schema for all values in the record
 * @param message - Optional custom validation error message
 * @returns Schema for Record<string, T> where T is the output type of the child schema
 *
 * @example
 * ```typescript
 * const userScores = record(uint()); // Record<string, number>
 * const metadata = record(string()); // Record<string, string>
 * ```
 */
export function record<S extends Schema<any>>(
    child: S,
    message?: string,
): Schema<Record<string, output<S>>> {
    if (!message) message = "Data must be a record (object with string keys)";

    return base<Record<string, output<S>>>(
        "record",
        (data, scratchPad) => {
            if (
                typeof data !== "object" ||
                data === null ||
                Array.isArray(data)
            ) {
                throw new ValidationError(message);
            }
            const writers: ((ctx: WriteContext) => void)[] = [];
            const keys = Object.keys(data).filter((k) =>
                Object.prototype.hasOwnProperty.call(data, k),
            );
            let size = getRollingUintSize(keys.length);
            for (const key of keys) {
                const keyLen = getEncodedLenNoAlloc(key);
                size += getRollingUintSize(keyLen) + keyLen;
                const [s, writer] = child.validateAndMakeWriter(
                    (data as any)[key],
                    scratchPad,
                );
                size += s;
                writers.push(writer);
            }
            return [
                size,
                (ctx: WriteContext) => {
                    ctx.pos = writeRollingUintNoAlloc(
                        keys.length,
                        ctx.buf,
                        ctx.pos,
                    );
                    for (const key of keys) {
                        const keyLen = getEncodedLenNoAlloc(key);
                        ctx.pos = writeRollingUintNoAlloc(
                            keyLen,
                            ctx.buf,
                            ctx.pos,
                        );
                        te.encodeInto(
                            key,
                            ctx.buf.subarray(ctx.pos, ctx.pos + keyLen),
                        );
                        ctx.pos += keyLen;
                        const writer = writers.shift()!;
                        writer(ctx);
                    }
                },
            ];
        },
        async (ctx, hijackReadContext, scratchPad) => {
            const len = await readRollingUintNoAlloc(ctx);
            const res: Record<string, output<S>> = {};
            for (let i = 0; i < len; i++) {
                const keyLen = await readRollingUintNoAlloc(ctx);
                const keyBytes = await ctx.readBytes(keyLen);
                const key = td.decode(keyBytes);
                const value = await child.readFromContext(
                    ctx,
                    hijackReadContext,
                    scratchPad,
                );
                res[key] = value[0];
            }
            return [res];
        },
        new Uint8Array([dataType.record, ...child.schema]),
    );
}

/**
 * Creates a schema for Map objects with specific key and value types.
 * Validates that data is a Map instance and that all entries conform to their respective schemas.
 * Preserves the Map structure and iteration order.
 *
 * @template K - The type of map keys
 * @template V - The type of map values
 * @param keySchema - Schema for map keys
 * @param valueSchema - Schema for map values
 * @param message - Optional custom validation error message
 * @returns Schema for Map<K, V> values
 *
 * @example
 * ```typescript
 * const userAges = map(string(), uint()); // Map<string, number>
 * const coordinates = map(string(), float()); // Map<string, number>
 * ```
 */
export function map<K, V>(
    keySchema: Schema<K>,
    valueSchema: Schema<V>,
    message?: string,
) {
    if (!message) message = "Data must be a Map";

    return base<Map<K, V>>(
        "map",
        (data, scratchPad) => {
            if (!(data instanceof Map)) {
                throw new ValidationError(message);
            }
            const writers: ((ctx: WriteContext) => void)[] = [];
            let size = getRollingUintSize(data.size);
            for (const [key, value] of data.entries()) {
                const [keySize, keyWriter] = keySchema.validateAndMakeWriter(
                    key,
                    scratchPad,
                );
                const [valueSize, valueWriter] =
                    valueSchema.validateAndMakeWriter(value, scratchPad);
                size += keySize + valueSize;
                writers.push((ctx: WriteContext) => {
                    keyWriter(ctx);
                    valueWriter(ctx);
                });
            }
            return [
                size,
                (ctx: WriteContext) => {
                    ctx.pos = writeRollingUintNoAlloc(
                        data.size,
                        ctx.buf,
                        ctx.pos,
                    );
                    for (const writer of writers) {
                        writer(ctx);
                    }
                },
            ];
        },
        async (ctx, hijackReadContext, scratchPad) => {
            const len = await readRollingUintNoAlloc(ctx);
            const res = new Map<K, V>();
            for (let i = 0; i < len; i++) {
                const keyValue = await keySchema.readFromContext(
                    ctx,
                    hijackReadContext,
                    scratchPad,
                );
                const valueValue = await valueSchema.readFromContext(
                    ctx,
                    hijackReadContext,
                    scratchPad,
                );
                res.set(keyValue[0], valueValue[0]);
            }
            return [res];
        },
        new Uint8Array([
            dataType.map,
            ...keySchema.schema,
            ...valueSchema.schema,
        ]),
    );
}

const compressionTableKey = Symbol("compressionTableKey");

const deepCompressionTableKey = Symbol("deepCompressionTableKey");

function useScratchPadValue<T>(
    scratchPad: { [key: symbol]: any },
    key: symbol,
    defaultValue: T,
): T {
    if (!(key in scratchPad)) {
        scratchPad[key] = defaultValue;
    }
    return scratchPad[key];
}

function createStreamBuffer(
    stream: ReadableStream<Uint8Array>,
): [() => ReadableStream<Uint8Array>, ReadableStream<Uint8Array>] {
    const tee = stream.tee();
    let x: ReadableStream<Uint8Array> = tee[0];
    return [
        () => {
            const newTee = x.tee();
            x = newTee[0];
            return newTee[1];
        },
        tee[1],
    ];
}

const errSymbol = Symbol("err");

function createIteratorBuffer(
    iter: AsyncIterable<any> | Iterable<any>,
): [() => AsyncIterable<any>, AsyncIterable<any>] {
    const readers: ((
        value: IteratorResult<any> | { [key: symbol]: any },
    ) => void)[] = [];
    const results: [any, any][] = [];

    (async () => {
        try {
            for await (const value of iter) {
                if (readers.length > 0) {
                    const reader = readers.shift()!;
                    reader({ value, done: false });
                } else {
                    results.push([value, errSymbol]);
                }
            }
            // Signal completion
            for (const reader of readers) {
                reader({ value: undefined, done: true });
            }
        } catch (err) {
            if (readers.length > 0) {
                // Signal error
                for (const reader of readers) {
                    reader({ [errSymbol]: err });
                }
            } else {
                // Store error for future readers
                results.push([undefined, err]);
            }
        }
    })();

    const newIterator: () => AsyncIterable<any> = () => {
        return {
            async *[Symbol.asyncIterator]() {
                for (;;) {
                    if (results.length > 0) {
                        const [value, err] = results.shift()!;
                        if (err === errSymbol) {
                            yield value;
                        } else {
                            throw err;
                        }
                    } else {
                        const result:
                            | IteratorResult<any>
                            | { [key: symbol]: any } = await new Promise(
                            (resolve) => {
                                readers.push(resolve);
                            },
                        );
                        if (errSymbol in result) {
                            throw result[errSymbol];
                        }
                        if ((result as IteratorResult<any>).done) {
                            return;
                        }
                        yield (result as IteratorResult<any>).value;
                    }
                }
            },
        };
    };

    return [newIterator, newIterator()];
}

class _CopyProtector {
    constructor(public clone: () => any) {}
}

function handleCopySafety(value: any): [any, any] {
    if (value instanceof ReadableStream) {
        const [cloner, stream] = createStreamBuffer(value);
        return [new _CopyProtector(cloner), stream];
    }

    if (
        value &&
        (typeof value[Symbol.asyncIterator] === "function" ||
            typeof value[Symbol.iterator] === "function")
    ) {
        const [cloner, iter] = createIteratorBuffer(value);
        return [new _CopyProtector(cloner), iter];
    }

    if (Array.isArray(value)) {
        const a = new Array(value.length);
        const b = new Array(value.length);
        for (let i = 0; i < value.length; i++) {
            const [childA, childB] = handleCopySafety(value[i]);
            a[i] = childA;
            b[i] = childB;
        }
        return [a, b];
    }

    return [value, value];
}

function writeOneCmpIndex(idx: number): [number, (ctx: WriteContext) => void] {
    const size = getRollingUintSize(idx + 1);
    return [
        size,
        (ctx: WriteContext) => {
            ctx.pos = writeRollingUintNoAlloc(idx + 1, ctx.buf, ctx.pos);
        },
    ];
}

function notIterableOrStream(data: any): boolean {
    if (data instanceof ReadableStream) {
        return false;
    }
    if (
        data &&
        (typeof data[Symbol.asyncIterator] === "function" ||
            typeof data[Symbol.iterator] === "function") &&
        typeof data === "object"
    ) {
        return false;
    }
    return true;
}

/**
 * Defines a schema that compresses repeated values using a compression table.
 * When a value is first encountered, it is stored in the table and serialized in full.
 * Subsequent occurrences of the same value are replaced with a reference index to the table.
 * If `deep` is true, deep equality checks are performed for objects and arrays.
 *
 * @template T - The schema type for the values being compressed
 * @param child - Schema for the values to be compressed
 * @param deep - Whether to use deep equality checks for objects/arrays
 * @returns Schema that compresses repeated values
 *
 * @example
 * ```typescript
 * const compressedStrings = compressionTable(string(), false);
 * const compressedObjects = compressionTable(object({ name: string(), age: uint() }), true);
 * ```
 */
export function compressionTable<T extends Schema<any>>(
    child: T,
    deep: boolean,
) {
    const randomStr = Math.random().toString(36).slice(2);
    return base<output<T>>(
        "compressionTable",
        (data, scratchPad) => {
            const reverseTable = useScratchPadValue(
                scratchPad,
                compressionTableKey,
                new Map<any, number>(),
            );

            const nonDeepVal = reverseTable.get(data);
            if (nonDeepVal !== undefined) {
                return writeOneCmpIndex(nonDeepVal);
            }

            const index = reverseTable.size;
            reverseTable.set(data, index);

            if (deep && notIterableOrStream(data)) {
                const deepReverseTable = useScratchPadValue(
                    scratchPad,
                    deepCompressionTableKey,
                    new Map<string, number>(),
                );

                // Turn it into a string representation for deep comparison
                const dataStr =
                    randomStr +
                    JSON.stringify(data, (_key, value) => {
                        if (value instanceof ReadableStream) {
                            return "[ReadableStream]";
                        }
                        if (!notIterableOrStream(value)) {
                            return "[Iterable]";
                        }
                        if (typeof value === "bigint") {
                            return value.toString() + "n";
                        }
                        if (value instanceof Map) {
                            return {
                                __type: "Map",
                                value: Array.from(value.entries()),
                            };
                        }
                        return value;
                    });
                const deepVal = deepReverseTable.get(dataStr);
                if (deepVal !== undefined) {
                    // Update non-deep table as well
                    reverseTable.set(data, deepVal);

                    return writeOneCmpIndex(deepVal);
                }

                // Otherwise, add to deep table
                deepReverseTable.set(dataStr, index);
            }

            // Write full value with a 0 prefix to indicate new entry
            const [size, writer] = child.validateAndMakeWriter(
                data,
                scratchPad,
            );
            return [
                size + getRollingUintSize(0),
                (ctx: WriteContext) => {
                    ctx.pos = writeRollingUintNoAlloc(0, ctx.buf, ctx.pos);
                    writer(ctx);
                },
            ];
        },
        async (ctx, hijackReadContext, scratchPad) => {
            const table = useScratchPadValue(
                scratchPad,
                compressionTableKey,
                [] as any[],
            );
            const index = await readRollingUintNoAlloc(ctx);
            if (index === 0) {
                const value = await child.readFromContext(
                    ctx,
                    hijackReadContext,
                    scratchPad,
                );
                const [parent, copySafeVal] = handleCopySafety(value[0]);
                table.push(parent);
                return [copySafeVal as output<T>];
            }
            const entry = table[index - 1];
            if (entry === undefined) {
                if (table.length >= index) {
                    return [undefined as output<T>];
                }
                throw new Error("internal: Invalid compression table index");
            }
            if (entry instanceof _CopyProtector) {
                return [entry.clone() as output<T>];
            }
            return [entry as output<T>];
        },
        new Uint8Array([dataType.compressionTable, ...child.schema]),
    );
}

function reflectDataToSchema(data: any): Schema<any> {
    if (Array.isArray(data)) {
        const elementSchemas: Schema<any>[] = [];
        const elementSet = new Set<string>();
        for (const element of data) {
            const res = reflectDataToSchema(element);
            if (!elementSet.has(res.name)) {
                elementSet.add(res.name);
                elementSchemas.push(res);
            }
        }
        if (elementSchemas.length === 0) {
            return array(any());
        }
        if (elementSchemas.length === 1) {
            return array(elementSchemas[0]);
        }
        return array(union(elementSchemas[0], ...elementSchemas.slice(1)));
    }

    switch (typeof data) {
        case "boolean":
            return boolean();
        case "number":
            if (Number.isInteger(data)) {
                if (data >= 0) {
                    return uint();
                } else {
                    return int();
                }
            } else {
                return float();
            }
        case "bigint":
            return bigint();
        case "string":
            return string();
        case "object":
            if (data === null) {
                return nullable();
            }
            if (data instanceof Uint8Array) {
                return uint8array();
            }
            if (data instanceof Map) {
                // Reflect map key and value types
                const keySchemas: Schema<any>[] = [];
                const keySet = new Set<string>();
                const valueSchemas: Schema<any>[] = [];
                const valueSet = new Set<string>();
                for (const [key, value] of data.entries()) {
                    const keyRes = reflectDataToSchema(key);
                    if (!keySet.has(keyRes.name)) {
                        keySet.add(keyRes.name);
                        keySchemas.push(keyRes);
                    }
                    const valueRes = reflectDataToSchema(value);
                    if (!valueSet.has(valueRes.name)) {
                        valueSet.add(valueRes.name);
                        valueSchemas.push(valueRes);
                    }
                }
                let keySchema: Schema<any>;
                if (keySchemas.length === 0) {
                    keySchema = any();
                } else if (keySchemas.length === 1) {
                    keySchema = keySchemas[0];
                } else {
                    keySchema = union(keySchemas[0], ...keySchemas.slice(1));
                }
                let valueSchema: Schema<any>;
                if (valueSchemas.length === 0) {
                    valueSchema = any();
                } else if (valueSchemas.length === 1) {
                    valueSchema = valueSchemas[0];
                } else {
                    valueSchema = union(
                        valueSchemas[0],
                        ...valueSchemas.slice(1),
                    );
                }
                return map(keySchema, valueSchema);
            }
            if (data instanceof ReadableStream) {
                return readableStream();
            }
            if (data[Symbol.iterator] || data[Symbol.asyncIterator]) {
                return iterator(any());
            }
            if (data instanceof Date) {
                return date();
            }
            if (data instanceof Promise) {
                return promise(any());
            }

            const fields: Record<string, Schema<any>> = {};
            for (const key of Object.keys(data)) {
                if (Object.prototype.hasOwnProperty.call(data, key)) {
                    fields[key] = reflectDataToSchema(data[key]);
                }
            }
            return object(fields);
        default:
            throw new Error(
                `internal: Cannot reflect data of unsupported type: ${typeof data}`,
            );
    }
}

/**
 * Creates a schema that accepts any supported data type.
 * Uses runtime reflection to determine the appropriate schema for the given data.
 * Dynamically creates the correct schema based on the data's type and structure.
 *
 * Warning: This schema has higher overhead due to runtime type reflection.
 * Consider using specific schemas when the data type is known in advance.
 *
 * @param message - Optional custom validation error message
 * @returns Schema for any supported value type
 *
 * @example
 * ```typescript
 * const dynamicData = any("Data must be a supported type");
 * const flexible = any(); // Accepts any supported type
 * ```
 */
export function any(message?: string) {
    if (!message) message = "Data must be any supported type";

    return base<any>(
        "any",
        (data, scratchPad) => {
            const schema = reflectDataToSchema(data);
            const [size, writer] = schema.validateAndMakeWriter(
                data,
                scratchPad,
            );
            return [
                schema.schema.length + size,
                (ctx) => {
                    ctx.buf.set(schema.schema, ctx.pos);
                    ctx.pos += schema.schema.length;
                    writer(ctx);
                },
            ];
        },
        async (ctx, hijackReadContext, scratchPad) => {
            const { reflectByteReprToSchema } = await import("./reflection");
            const schema = await reflectByteReprToSchema(ctx);
            return schema.readFromContext(ctx, hijackReadContext, scratchPad);
        },
        new Uint8Array([dataType.any]),
    );
}
