import { array, boolean, iterator, object, promise, string, uint8array, type ReadContext, type Schema } from "./schemas";
import { dataType, readRollingUintNoAlloc } from "./utils";

const td = new TextDecoder();

export async function reflectToSchema(ctx: ReadContext): Promise<Schema<any>> {
    const typeByte = await ctx.readByte();
    switch (typeByte) {
        case dataType.array:
            return array(await reflectToSchema(ctx));
        case dataType.boolean:
            return boolean();
        case dataType.bytes:
            return uint8array();
        case dataType.iterator:
            return iterator(await reflectToSchema(ctx));
        case dataType.object: {
            const numFields = await readRollingUintNoAlloc(ctx);
            const fields: Record<string, Schema<any>> = {};
            for (let i = 0; i < numFields; i++) {
                const fieldNameLength = await readRollingUintNoAlloc(ctx);
                const fieldNameBytes = await ctx.readBytes(fieldNameLength);
                const fieldName = td.decode(fieldNameBytes);
                fields[fieldName] = await reflectToSchema(ctx);
            }
            return object(fields);
        }
        case dataType.promise:
            return promise(await reflectToSchema(ctx));
        case dataType.string:
            return string();
        default:
            throw new Error(`Unknown type byte in reflected schema: ${typeByte}`);
    }
}
