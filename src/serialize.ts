import type { Writable } from "stream";
import type { Schema } from "./schemas";
import type { WriteContext } from "./utils";
import { getHash, output } from "./deserialize";

function waitGroup() {
    const promises: Set<Promise<void>> = new Set();
    return {
        add() {
            let resolve: () => void;
            const p = new Promise<void>((r) => {
                resolve = r;
            });
            promises.add(p);
            return () => {
                resolve();
                promises.delete(p);
            };
        },
        async wait() {
            while (promises.size > 0) {
                await Promise.all(promises);
            }
        },
    };
}

async function browserSerialize<Resolved, S extends Schema<Resolved>>(
    schema: S,
    writable: WritableStream,
    data: Resolved,
    lastUpdateIsUs: boolean,
) {
    // Figure out the size of the schema.
    let size = 1;
    if (!lastUpdateIsUs) {
        size += schema.schema.length;
    }
    const [valueSize, writeData] = schema.validateAndMakeWriter(data, {});
    size += valueSize;

    // Create a buffer of that size and write the header.
    const buffer = new Uint8Array(size);
    if (!lastUpdateIsUs) {
        buffer[0] = 1; // We need to send the schema.
        buffer.set(schema.schema, 1);
    }

    // Write the data.
    const writer = writable.getWriter();

    // Defines the sender queue.
    let socketOpen = true;
    let pendingQueue: [number, Uint8Array | Buffer][] | null = [];
    let socketId = 1;
    let connectedCount = 0;
    const wg = waitGroup();
    const createWriteStream = () => {
        const closer = wg.add();
        const id = socketId++;
        let connected = true;
        connectedCount++;

        return [
            id,
            (chunk: Uint8Array | Buffer | null) => {
                if (!socketOpen) return;
                if (!connected) throw new Error("Stream is closed");

                if (chunk === null) {
                    connected = false;
                    connectedCount--;
                    if (connectedCount === 0) {
                        pendingQueue = null;
                    }
                    closer();
                    return;
                }

                if (pendingQueue !== null) {
                    pendingQueue.push([id, chunk]);
                    return;
                }

                if (socketOpen) {
                    const newAlloc = new Uint8Array(chunk.length + 2);
                    newAlloc[0] = (id >> 8) & 0xff;
                    newAlloc[1] = id & 0xff;
                    newAlloc.set(chunk, 2);
                    writer.write(newAlloc).catch(() => {
                        socketOpen = false;
                    });
                }
            },
        ] as [number, (chunk: Uint8Array | Buffer | null) => void];
    };

    // Write into the context.
    const baseCtx: WriteContext = {
        buf: buffer,
        pos: 1 + (lastUpdateIsUs ? 0 : schema.schema.length),
        createWriteStream,
    };
    writeData(baseCtx);

    // Write the buffer.
    await writer.write(buffer);

    // Flush the pending queue.
    const pq = pendingQueue;
    pendingQueue = null;
    if (pq) {
        for (const [id, chunk] of pq) {
            if (!socketOpen) break;
            const newAlloc = new Uint8Array(chunk.length + 2);
            newAlloc[0] = (id >> 8) & 0xff;
            newAlloc[1] = id & 0xff;
            newAlloc.set(chunk, 2);
            await writer.write(newAlloc).catch((e: any) => {
                socketOpen = false;
                throw e;
            });
        }
    }

    // Wait for all streams to close.
    await wg.wait();

    // Close the connection.
    if (socketOpen) {
        await writer.close().catch(() => {});
    }
}

/**
 * Serializes data using a schema to either a Node.js Writable stream or browser WritableStream.
 * Supports both streaming and buffered serialization with automatic schema negotiation.
 *
 * The function handles:
 * - Schema validation and size calculation
 * - Efficient binary encoding
 * - Stream management for nested async data (Promises, iterators, etc.)
 * - Cross-platform compatibility (Node.js vs browser)
 * - Optimized schema transmission (only sends schema if changed)
 *
 * @template S - The schema type
 * @param schema - Schema defining the structure and validation rules for the data
 * @param writable - Target stream (Node.js Writable or browser WritableStream)
 * @param data - Data to serialize, must conform to the schema type
 * @param lastUpdateHash - Optional hash of the last schema used, for optimization (generally sent from the client)
 * @returns Promise that resolves when serialization is complete
 *
 * @example
 * ```typescript
 * // Serialize a user object
 * const userSchema = object({
 *   name: string(),
 *   age: uint(),
 *   active: boolean()
 * });
 *
 * await serialize(userSchema, writableStream, {
 *   name: "John",
 *   age: 30,
 *   active: true
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Serialize with schema optimization
 * const hash = await getHash(mySchema);
 * await serialize(mySchema, stream, data, hash);
 * ```
 */
export async function serialize<S extends Schema<any>>(
    schema: S,
    writable: Writable | WritableStream<Uint8Array>,
    data: output<S>,
    lastUpdateHash?: string,
) {
    const ourHash = await getHash(schema);
    const lastUpdateIsUs = lastUpdateHash === ourHash;

    if (writable instanceof WritableStream)
        return browserSerialize(schema, writable, data, lastUpdateIsUs);

    // Presume we have a node.js writable stream

    if (!Buffer) {
        throw new Error("Buffer is not defined");
    }

    // Figure out the size of the schema.
    let size = 1;
    if (!lastUpdateIsUs) {
        size += schema.schema.length;
    }
    const [valueSize, writeData] = schema.validateAndMakeWriter(data, {});
    size += valueSize;

    // Create a buffer of that size and write the header.
    const buffer = Buffer.allocUnsafe(size);
    if (!lastUpdateIsUs) {
        buffer[0] = 1; // We need to send the schema.
        Buffer.from(schema.schema).copy(buffer, 1);
    }

    // Defines the sender queue.
    let socketOpen = true;
    let pendingQueue: [number, Buffer][] | null = [];
    let socketId = 0;
    let connectedCount = 0;
    const wg = waitGroup();
    const createWriteStream = () => {
        const closer = wg.add();
        const id = socketId++;
        let connected = true;
        connectedCount++;

        return [
            id,
            (chunk: Uint8Array | Buffer | null) => {
                if (!socketOpen) return;
                if (!connected) throw new Error("Stream is closed");

                if (chunk === null) {
                    connected = false;
                    connectedCount--;
                    if (connectedCount === 0) {
                        pendingQueue = null;
                        writable.end();
                    }
                    closer();
                    return;
                }

                if (pendingQueue !== null) {
                    pendingQueue.push([id, Buffer.from(chunk)]);
                    return;
                }

                if (socketOpen) {
                    const newAlloc = Buffer.allocUnsafe(chunk.length + 2);
                    newAlloc[0] = (id >> 8) & 0xff;
                    newAlloc[1] = id & 0xff;
                    Buffer.from(chunk).copy(newAlloc, 2);
                    writable.write(newAlloc, (err) => {
                        if (err) {
                            socketOpen = false;
                        }
                    });
                }
            },
        ] as [number, (chunk: Uint8Array | Buffer | null) => void];
    };

    // Write into the context.
    const baseCtx: WriteContext = {
        buf: buffer,
        pos: 1 + (lastUpdateIsUs ? 0 : schema.schema.length),
        createWriteStream,
    };
    writeData(baseCtx);

    // Write the buffer.
    await new Promise<void>((resolve, reject) => {
        writable.write(buffer, (err) => {
            if (err) return reject(err);
            resolve();
        });
    });

    // Flush the pending queue.
    const pq = pendingQueue;
    pendingQueue = null;
    if (pq) {
        for (const [id, chunk] of pq) {
            if (!socketOpen) break;
            const newAlloc = Buffer.allocUnsafe(chunk.length + 2);
            newAlloc[0] = (id >> 8) & 0xff;
            newAlloc[1] = id & 0xff;
            chunk.copy(newAlloc, 2);
            await new Promise<void>((resolve, reject) => {
                writable.write(newAlloc, (err) => {
                    if (err) {
                        socketOpen = false;
                        return reject(err);
                    }
                    resolve();
                });
            });
        }
    }

    // Wait for all streams to close.
    await wg.wait();

    // Close the connection.
    if (socketOpen) {
        writable.end();
    }
}

/**
 * Serializes data to a buffer using the provided schema.
 *
 * This function is useful for scenarios where you need to serialize data
 * into a fixed-size binary format for storage or transmission without using streams.
 *
 * @template S - The schema type
 * @param schema - Schema defining the structure and validation rules for the data
 * @param data - Data to serialize, must conform to the schema type
 * @returns A Buffer containing the serialized binary data
 *
 * @example
 * ```typescript
 * // Serialize a user object to a buffer
 * const userSchema = object({
 *   name: string(),
 *   age: uint(),
 *   active: boolean()
 * });
 *
 * const buffer = await serializeToBuffer(userSchema, {
 *   name: "John",
 *   age: 30,
 *   active: true
 * });
 * ```
 */
export async function serializeToBuffer<S extends Schema<any>>(
    schema: S,
    data: output<S>,
): Promise<Buffer> {
    // Figure out the size of the schema. We don't send the "has schema" byte here.
    let size = schema.schema.length;
    const [valueSize, writeData] = schema.validateAndMakeWriter(data, {});
    size += valueSize;

    // Create a buffer of that size and write the header.
    const buffer = Buffer.allocUnsafe(size);
    buffer.set(schema.schema, 0);

    // Write into the context.
    const childBuffers: Buffer[] = [];
    let pendingQueue: [number, Buffer][] | null = [];
    let socketId = 0;
    let connectedCount = 0;
    const wg = waitGroup();
    const createWriteStream = () => {
        const closer = wg.add();
        const id = socketId++;
        let connected = true;
        connectedCount++;

        return [
            id,
            (chunk: Uint8Array | Buffer | null) => {
                if (!connected) throw new Error("Stream is closed");

                if (chunk === null) {
                    connected = false;
                    connectedCount--;
                    if (connectedCount === 0) {
                        pendingQueue = null;
                    }
                    closer();
                    return;
                }

                if (pendingQueue !== null) {
                    pendingQueue.push([id, Buffer.from(chunk)]);
                    return;
                }

                childBuffers.push(Buffer.from(chunk));
            },
        ] as [number, (chunk: Uint8Array | Buffer | null) => void];
    };

    const baseCtx: WriteContext = {
        buf: buffer,
        pos: schema.schema.length,
        createWriteStream,
    };
    writeData(baseCtx);

    // Flush the pending queue.
    const pq = pendingQueue;
    pendingQueue = null;
    if (pq) {
        for (const [id, chunk] of pq) {
            const newAlloc = Buffer.allocUnsafe(chunk.length + 2);
            newAlloc[0] = (id >> 8) & 0xff;
            newAlloc[1] = id & 0xff;
            chunk.copy(newAlloc, 2);
            childBuffers.push(newAlloc);
        }
    }

    // Wait for all streams to close.
    await wg.wait();

    // If we have child buffers, concatenate them.
    let endResult = buffer;
    let offset = buffer.length;
    if (childBuffers.length > 0) {
        endResult = Buffer.allocUnsafe(
            buffer.length + childBuffers.reduce((a, b) => a + b.length, 0),
        );
        buffer.copy(endResult, 0);
        for (const childBuffer of childBuffers) {
            childBuffer.copy(endResult, offset);
            offset += childBuffer.length;
        }
    }

    return endResult;
}

/**
 * Serializes data using a schema to a Uint8Array buffer.
 *
 * This function is useful for scenarios where you need to serialize data
 * into a fixed-size binary format for storage or transmission without using streams.
 * @template S - The schema type
 * @param schema - Schema defining the structure and validation rules for the data
 * @param data - Data to serialize, must conform to the schema type
 * @returns A Uint8Array containing the serialized binary data
 * @example
 * ```typescript
 * // Serialize a user object to a Uint8Array
 * const userSchema = object({
 *   name: string(),
 *   age: uint(),
 *   active: boolean()
 * });
 * const uint8Array = await serializeToUint8Array(userSchema, {
 *   name: "John",
 *   age: 30,
 *   active: true
 * });
 * ```
 */
export async function serializeToUint8Array<S extends Schema<any>>(
    schema: S,
    data: output<S>,
): Promise<Uint8Array> {
    // Figure out the size of the schema. We don't send the "has schema" byte here.
    let size = schema.schema.length;
    const [valueSize, writeData] = schema.validateAndMakeWriter(data, {});
    size += valueSize;

    // Create a buffer of that size and write the header.
    const buffer = new Uint8Array(size);
    buffer.set(schema.schema, 0);

    // Write into the context.
    const childBuffers: Uint8Array[] = [];
    let pendingQueue: [number, Uint8Array][] | null = [];
    let socketId = 0;
    let connectedCount = 0;
    const wg = waitGroup();
    const createWriteStream = () => {
        const closer = wg.add();
        const id = socketId++;
        let connected = true;
        connectedCount++;

        return [
            id,
            (chunk: Uint8Array | null) => {
                if (!connected) throw new Error("Stream is closed");

                if (chunk === null) {
                    connected = false;
                    connectedCount--;
                    if (connectedCount === 0) {
                        pendingQueue = null;
                    }
                    closer();
                    return;
                }

                if (pendingQueue !== null) {
                    pendingQueue.push([id, chunk]);
                    return;
                }

                childBuffers.push(chunk);
            },
        ] as [number, (chunk: Uint8Array | null) => void];
    };

    const baseCtx: WriteContext = {
        buf: buffer,
        pos: schema.schema.length,
        createWriteStream,
    };
    writeData(baseCtx);

    // Flush the pending queue.
    const pq = pendingQueue;
    pendingQueue = null;
    if (pq) {
        for (const [id, chunk] of pq) {
            const newAlloc = new Uint8Array(chunk.length + 2);
            newAlloc[0] = (id >> 8) & 0xff;
            newAlloc[1] = id & 0xff;
            newAlloc.set(chunk, 2);
            childBuffers.push(newAlloc);
        }
    }

    // Wait for all streams to close.
    await wg.wait();

    // If we have child buffers, concatenate them.
    let endResult = buffer;
    let offset = buffer.length;
    if (childBuffers.length > 0) {
        endResult = new Uint8Array(
            buffer.length + childBuffers.reduce((a, b) => a + b.length, 0),
        );
        endResult.set(buffer, 0);
        for (const childBuffer of childBuffers) {
            endResult.set(childBuffer, offset);
            offset += childBuffer.length;
        }
    }

    return endResult;
}
