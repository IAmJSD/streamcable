import { dataType, readRollingUintNoAlloc } from "./utils";

export type WriteContext = {
    buf: Uint8Array;
    pos: number;
    createWriteStream: () => [
        number,
        (chunk: Uint8Array | Buffer | null) => void
    ];
};

export type ReadContext = {
    readByte: () => Promise<number>;
    readBytes: (length: number) => Promise<Uint8Array>;
};

function base<T>(
    name: string,
    calculateSize: (data: unknown) => number,
    writeIntoContext: (ctx: WriteContext, data: T) => void,
    readFromContext: (
        ctx: ReadContext,
        hijackReadContext: (
            id: number,
            cb: (ctx: ReadContext) => Promise<void>,
        ) => (slurp: boolean) => void,
    ) => Promise<[T]>,
    schema: Uint8Array<ArrayBuffer>,
) {
    return {
        name,
        calculateSize,
        writeIntoContext,
        readFromContext,
        schema,
    } as const;
}

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

export function pipe<T>(
    from: Schema<T>,
    into: (data: T) => T,
): Schema<T> {
    return {
        name: "pipe",
        calculateSize: from.calculateSize,
        writeIntoContext: (ctx, data) => {
            from.writeIntoContext(ctx, into(data));
        },
        readFromContext: from.readFromContext,
        schema: from.schema,
    } as const;
}

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

export function array<T>(elements: Schema<T>, message?: string) {
    if (!message) message = "Data must be an array";

    const schema = new Uint8Array([dataType.array, ...elements.schema]);

    return base<T[]>(
        "array",
        (data) => {
            if (!Array.isArray(data)) throw new ValidationError(message);
            let size = getRollingUintSize(data.length);
            for (const item of data) {
                size += elements.calculateSize(item);
            }
            return size;
        },
        (ctx, data) => {
            if (!Array.isArray(data)) throw new ValidationError(message);
            ctx.pos = writeRollingUintNoAlloc(data.length, ctx.buf, ctx.pos);
            for (const item of data) {
                elements.writeIntoContext(ctx, item);
            }
        },
        async (ctx, hijackReadContext) => {
            const len = await readRollingUintNoAlloc(ctx);
            const res: T[] = [];
            for (let i = 0; i < len; i++) {
                const item = await elements.readFromContext(ctx, hijackReadContext);
                res.push(item[0]);
            }
            return [res];
        },
        schema,
    );
}

export type ObjectSchemas = {
    [key: string]: Schema<any>;
};

const te = new TextEncoder();

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
        (data) => {
            if (typeof data !== "object" || data === null || Array.isArray(data)) {
                throw new ValidationError(message);
            }
            let size = 0;
            for (const key of keys) {
                size += schemas[key].calculateSize((data as any)[key]);
            }
            return size;
        },
        (ctx, data) => {
            if (typeof data !== "object" || data === null || Array.isArray(data)) {
                throw new ValidationError(message);
            }
            for (const key of keys) {
                schemas[key].writeIntoContext(ctx, (data as any)[key]);
            }
        },
        async (ctx, hijackReadContext) => {
            const res: any = {};
            for (const key of keys) {
                const value = await schemas[key].readFromContext(ctx, hijackReadContext);
                res[key] = value[0];
            }
            return [res as Resolved];
        },
        schema,
    );
}

const td = new TextDecoder();

export function string(message?: string) {
    if (!message) message = "Data must be a string";
    return base<string>(
        "string",
        (data) => {
            if (typeof data !== "string") throw new ValidationError(message);
            const len = getEncodedLenNoAlloc(data);
            return getRollingUintSize(len) + len;
        },
        (ctx, data) => {
            if (typeof data !== "string") throw new ValidationError(message);
            const len = getEncodedLenNoAlloc(data);
            ctx.pos = writeRollingUintNoAlloc(len, ctx.buf, ctx.pos);
            te.encodeInto(data, ctx.buf.subarray(ctx.pos, ctx.pos + len));
            ctx.pos += len;
        },
        async (ctx) => {
            const len = await readRollingUintNoAlloc(ctx);
            const bytes = await ctx.readBytes(len);

            return [td.decode(bytes)];
        },
        new Uint8Array([dataType.string]),
    );
}

export function uint8array(message?: string) {
    if (!message) message = "Data must be a Uint8Array";
    return base<Uint8Array>(
        "uint8array",
        (data) => {
            if (!(data instanceof Uint8Array)) throw new ValidationError(message);
            const len = data.length;
            return getRollingUintSize(len) + len;
        },
        (ctx, data) => {
            if (!(data instanceof Uint8Array)) throw new ValidationError(message);
            const len = data.length;
            ctx.pos = writeRollingUintNoAlloc(len, ctx.buf, ctx.pos);
            ctx.buf.set(data, ctx.pos);
            ctx.pos += len;
        },
        async (ctx) => {
            const len = await readRollingUintNoAlloc(ctx);
            const bytes = await ctx.readBytes(len);
            return [bytes];
        },
        new Uint8Array([dataType.u8array]),
    );
}

export function buffer(message?: string) {
    if (!message) message = "Data must be a Buffer";
    return base<Buffer>(
        "buffer",
        (data) => {
            if (!Buffer.isBuffer(data)) throw new ValidationError(message);
            const len = data.length;
            return getRollingUintSize(len) + len;
        },
        (ctx, data) => {
            if (!Buffer.isBuffer(data)) throw new ValidationError(message);
            const len = data.length;
            ctx.pos = writeRollingUintNoAlloc(len, ctx.buf, ctx.pos);
            ctx.buf.set(data, ctx.pos);
            ctx.pos += len;
        },
        async (ctx) => {
            const len = await readRollingUintNoAlloc(ctx);
            const bytes = await ctx.readBytes(len);
            return [Buffer.from(bytes)];
        },
        new Uint8Array([dataType.buffer]),
    );
}

export class SerializableError<T> extends Error {
    constructor(public schema: Schema<T>, public data: T) {
        super("SerializableError");
        this.name = "SerializableError";
    }
}

export function promise<T>(inner: Schema<T>, message?: string) {
    if (!message) message = "Data must be a Promise";

    const schema = new Uint8Array([dataType.promise, ...inner.schema]);

    return base<Promise<T>>(
        "promise",
        () => 2, // 2 for the stream pointer
        (ctx, data) => {
            if (!(data instanceof Promise)) throw new ValidationError(message);
            const [id, writer] = ctx.createWriteStream();
            ctx.buf[ctx.pos] = (id >> 8) & 0xff;
            ctx.buf[ctx.pos + 1] = id & 0xff;
            ctx.pos += 2;
            data.then((value) => {
                const size = inner.calculateSize(value);
                const buf = new Uint8Array(1 + size); // 1 byte for success flag
                buf[0] = 1; // success
                const writeCtx: WriteContext = {
                    buf,
                    pos: 1,
                    createWriteStream: ctx.createWriteStream,
                };
                inner.writeIntoContext(writeCtx, value);
                writer(buf);
                writer(null);
            }).catch((err) => {
                if (err instanceof SerializableError) {
                    // Get the size of the serialized error data
                    const size = err.schema.calculateSize(err.data);
                    const buf = new Uint8Array(1 + err.schema.schema.length + size);
                    buf[0] = 0; // failure
                    buf.set(err.schema.schema, 1);
                    const writeCtx: WriteContext = {
                        buf,
                        pos: 1 + err.schema.schema.length,
                        createWriteStream: ctx.createWriteStream,
                    };
                    err.schema.writeIntoContext(writeCtx, err.data);
                    writer(buf);
                    writer(null);
                    return;
                }

                throw err;
            });
        },
        async (ctx, hijackReadContext) => {
            const idHigh = await ctx.readByte();
            const idLow = await ctx.readByte();
            const id = (idHigh << 8) | idLow;

            let cleanup: (slurp: boolean) => void;
            const promise = new Promise<T>((resolve, reject) => {
                cleanup = hijackReadContext(id, async (streamCtx) => {
                    try {
                        const flag = await streamCtx.readByte();
                        if (flag === 1) {
                            // success
                            const value = await inner.readFromContext(streamCtx, hijackReadContext);
                            resolve(value[0]);
                            return;
                        }

                        if (flag === 0) {
                            // failure
                            const { reflectByteReprToSchema } = await import("./reflection");
                            const errorSchema = await reflectByteReprToSchema(streamCtx);
                            const errorData = await errorSchema.readFromContext(streamCtx, hijackReadContext);
                            reject(new SerializableError(errorSchema, errorData[0]));
                            return;
                        }

                        reject(new Error("internal: Invalid promise resolution flag"));
                    } catch (err) {
                        reject(err);
                        return;
                    } finally {
                        cleanup(false);
                    }
                });
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

export function iterator<T>(elements: Schema<T>, message?: string) {
    if (!message) message = "Data must be an iterator";

    const schema = new Uint8Array([dataType.iterator, ...elements.schema]);

    return base<Iterable<T> | AsyncIterable<T>>(
        "iterator",
        () => 2, // 2 for the stream pointer
        (ctx, data) => {
            if (typeof data !== "object" || data === null || (!(data as any)[Symbol.iterator] && !(data as any)[Symbol.asyncIterator])) {
                throw new ValidationError(message);
            }
            const [id, writer] = ctx.createWriteStream();
            ctx.buf[ctx.pos] = (id >> 8) & 0xff;
            ctx.buf[ctx.pos + 1] = id & 0xff;
            ctx.pos += 2;
            (async () => {
                try {
                    for await (const item of data as any) {
                        const size = elements.calculateSize(item);
                        const buf = new Uint8Array(1 + size); // 1 byte for continuation flag
                        buf[0] = 1; // continuation
                        const writeCtx: WriteContext = {
                            buf,
                            pos: 1,
                            createWriteStream: ctx.createWriteStream,
                        };
                        elements.writeIntoContext(writeCtx, item);
                        writer(buf);
                    }
                    const buf = new Uint8Array(1);
                    buf[0] = 0; // end of iterator
                    writer(buf);
                    writer(null);
                } catch (err) {
                    if (err instanceof SerializableError) {
                        // Get the size of the serialized error data
                        const size = err.schema.calculateSize(err.data);
                        const buf = new Uint8Array(1 + err.schema.schema.length + size);
                        buf[0] = 0;
                        buf.set(err.schema.schema, 1);
                        const writeCtx: WriteContext = {
                            buf,
                            pos: 1 + err.schema.schema.length,
                            createWriteStream: ctx.createWriteStream,
                        };
                        err.schema.writeIntoContext(writeCtx, err.data);
                        writer(buf);
                        writer(null);
                        return;
                    }

                    throw err;
                }
            })();
        },
        async (ctx, hijackReadContext) => {
            const idHigh = await ctx.readByte();
            const idLow = await ctx.readByte();
            const id = (idHigh << 8) | idLow;

            throw new Error("iterator deserialization is not yet implemented");
        },
        schema,
    );
}

export function boolean(message?: string) {
    if (!message) message = "Data must be a boolean";
    return base<boolean>(
        "boolean",
        (data) => {
            if (typeof data !== "boolean") throw new ValidationError(message);
            return 1;
        },
        (ctx, data) => {
            if (typeof data !== "boolean") throw new ValidationError(message);
            ctx.buf[ctx.pos] = data ? 1 : 0;
            ctx.pos += 1;
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
