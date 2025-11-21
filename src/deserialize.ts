import type { Schema } from "./schemas";
import { ReadContext, OutOfDataError } from "./ReadContext";

const weakHashMap = new WeakMap<Uint8Array, string>();

/**
 * The output type of a schema. Given a schema `T`, `output<T>` is the type of data
 * that schema represents.
 *
 * @template T - A schema type extending Schema<any>
 *
 * @example
 * ```typescript
 * const userSchema = object({ name: string(), age: uint() });
 * type User = output<typeof userSchema>; // { name: string; age: number }
 * ```
 */
export type output<T extends Schema<any>> =
    T extends Schema<infer R> ? R : never;

/**
 * Gets the SHA-1 hash for a schema's binary representation.
 * Results are cached to avoid recomputation for the same schema.
 *
 * @param schema - The schema to hash
 * @returns Promise resolving to the SHA-1 hash as a hex string
 *
 * @example
 * ```typescript
 * const schema = object({ name: string() });
 * const hash = await getHash(schema); // "a1b2c3d4e5f6..."
 * ```
 */
export async function getHash(schema: Schema<any>) {
    const res = weakHashMap.get(schema.schema);
    if (res) return res;

    const hash = await crypto.subtle
        .digest("SHA-1", schema.schema)
        .then((buf) => {
            return Array.from(new Uint8Array(buf))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
        });
    weakHashMap.set(schema.schema, hash);
    return hash;
}

/**
 * Deserializes data from a stream using the provided schema.
 * Handles streaming deserialization with support for complex nested data types.
 *
 * The function manages:
 * - Schema negotiation and dynamic schema loading
 * - Stream coordination for async data (Promises, iterators, etc.)
 * - Proper resource cleanup and connection management
 * - Cross-platform stream handling
 *
 * @template S - The schema type
 * @param schema - Schema defining the expected data structure
 * @param getReader - Function that returns a ReadableStream for the given schema hash and abort signal
 * @returns Promise resolving to the deserialized data of type output<S>
 *
 * @example
 * ```typescript
 * const userSchema = object({
 *   name: string(),
 *   age: uint(),
 *   active: boolean()
 * });
 *
 * const user = await deserialize(userSchema, async (hash, signal) => {
 *   const response = await fetch(`/api/data/${hash}`, { signal });
 *   return response.body!;
 * });
 *
 * console.log(user); // { name: "John", age: 30, active: true }
 * ```
 */
export async function deserialize<S extends Schema<any>>(
    schema: S,
    getReader: (
        schemaHash: string,
        abortSignal: AbortSignal,
    ) => Promise<ReadableStream<Uint8Array>>,
): Promise<output<S>> {
    const schemaHash = await getHash(schema);
    const abortController = new AbortController();
    const handlers = new Map<number, (ctx: ReadContext) => Promise<void>>();

    const reader = await getReader(schemaHash, abortController.signal);
    const readCtx = new ReadContext(reader.getReader());

    const payloadHasSchema = await readCtx.readByte();
    if (payloadHasSchema === 1) {
        // Use reflection to read the schema.
        const { reflectByteReprToSchema } = await import("./reflection");
        schema = (await reflectByteReprToSchema(readCtx)) as S;
    }

    const disconnectHandlers = new Map<number, () => void>();

    let usages = 0;
    const hijackReadContext = (
        id: number,
        fn: (ctx: ReadContext) => Promise<void>,
        onDisconnect: () => void,
    ) => {
        usages++;
        handlers.set(id, fn);
        disconnectHandlers.set(id, onDisconnect);
        let cleanedUp = false;
        return (slurp: boolean) => {
            if (cleanedUp) return;
            cleanedUp = true;
            disconnectHandlers.delete(id);
            if (!slurp) {
                handlers.delete(id);
            }
            usages--;
            if (usages === 0) {
                // Abort now.
                abortController.abort();
            }
        };
    };

    const result = (
        await schema.readFromContext(readCtx, hijackReadContext, {})
    )[0];
    if (usages === 0) {
        // Abort now.
        abortController.abort();
    }

    (async () => {
        try {
            while (usages > 0) {
                const idHigh = await readCtx.readByte();
                const idLow = await readCtx.readByte();
                const id = (idHigh << 8) | idLow;

                const handler = handlers.get(id);
                if (handler) {
                    await handler(readCtx);
                }
            }
        } catch (e) {
            if (!(e instanceof OutOfDataError)) {
                throw e;
            }
            for (const disconnectHandler of disconnectHandlers.values()) {
                disconnectHandler();
            }
        }
    })();

    return result;
}
