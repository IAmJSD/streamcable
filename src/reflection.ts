import {
    any,
    array,
    bigint,
    boolean,
    buffer,
    compressionTable,
    date,
    float,
    int,
    iterator,
    map,
    nullable,
    object,
    optional,
    potentiallyFloatString,
    promise,
    readableStream,
    record,
    string,
    uint,
    uint8,
    uint8array,
    union,
    type Schema,
} from "./schemas";
import { dataType, readRollingUintNoAlloc } from "./utils";
import type { ReadContext } from "./ReadContext";

const td = new TextDecoder();

export async function reflectByteReprToSchema(
    ctx: ReadContext,
): Promise<Schema<any>> {
    const typeByte = await ctx.readByte();
    switch (typeByte) {
        case dataType.array:
            return array(await reflectByteReprToSchema(ctx));
        case dataType.boolean:
            return boolean();
        case dataType.u8array:
            return uint8array();
        case dataType.buffer:
            return buffer();
        case dataType.iterator:
            return iterator(await reflectByteReprToSchema(ctx));
        case dataType.object: {
            const numFields = await readRollingUintNoAlloc(ctx);
            const fields: Record<string, Schema<any>> = {};
            for (let i = 0; i < numFields; i++) {
                const fieldNameLength = await readRollingUintNoAlloc(ctx);
                const fieldNameBytes = await ctx.readBytes(fieldNameLength);
                const fieldName = td.decode(fieldNameBytes);
                fields[fieldName] = await reflectByteReprToSchema(ctx);
            }
            return object(fields);
        }
        case dataType.promise:
            return promise(await reflectByteReprToSchema(ctx));
        case dataType.string:
            return string();
        case dataType.uint8:
            return uint8();
        case dataType.uint:
            return uint();
        case dataType.union: {
            const numOptions = (await readRollingUintNoAlloc(ctx)) + 1;
            const options: Schema<any>[] = [];
            for (let i = 0; i < numOptions; i++) {
                options.push(await reflectByteReprToSchema(ctx));
            }
            return union(options.shift()!, ...options);
        }
        case dataType.date:
            return date();
        case dataType.int:
            return int();
        case dataType.float:
            return float();
        case dataType.nullable: {
            const next = await ctx.peekByte();
            if (next === 0x00) {
                // No child
                return nullable();
            }
            return nullable(await reflectByteReprToSchema(ctx));
        }
        case dataType.optional:
            return optional(await reflectByteReprToSchema(ctx));
        case dataType.bigint:
            return bigint();
        case dataType.readableStream:
            return readableStream();
        case dataType.record:
            return record(await reflectByteReprToSchema(ctx));
        case dataType.map:
            return map(
                await reflectByteReprToSchema(ctx),
                await reflectByteReprToSchema(ctx),
            );
        case dataType.any:
            return any();
        case dataType.compressionTable:
            // deep doesn't matter for read reflection
            return compressionTable(await reflectByteReprToSchema(ctx), false);
        case dataType.potentiallyFloatString:
            return potentiallyFloatString();
        default:
            throw new Error(
                `Unknown type byte in reflected schema: ${typeByte}`,
            );
    }
}
