import {
    array,
    boolean,
    buffer,
    iterator,
    object,
    promise,
    string,
    uint,
    uint8,
    uint8array,
    type ReadContext,
    type Schema,
} from "./schemas";
import { dataType, readRollingUintNoAlloc } from "./utils";

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
        default:
            throw new Error(
                `Unknown type byte in reflected schema: ${typeByte}`,
            );
    }
}
