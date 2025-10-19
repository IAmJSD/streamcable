import type { ReadContext } from "./schemas";

export const dataType = {
    array: 0x01,
    object: 0x02,
    string: 0x03,

    // Seperate so that JS can distinguish between Uint8Array and Buffer
    // In most languages, treat both as byte arrays.
    u8array: 0x04,
    buffer: 0x05,

    promise: 0x06,
    iterator: 0x07,
    boolean: 0x08,
    uint8: 0x09,
    uint: 0x0a,
};

export async function readRollingUintNoAlloc(ctx: ReadContext): Promise<number> {
    const firstByte = await ctx.readByte();
    if (firstByte < 0xfd) {
        return firstByte;
    }
    if (firstByte === 0xfd) {
        const bytes = await ctx.readBytes(2);
        return bytes[0] | (bytes[1] << 8);
    }
    if (firstByte === 0xfe) {
        const bytes = await ctx.readBytes(4);
        return (
            bytes[0] |
            (bytes[1] << 8) |
            (bytes[2] << 16) |
            (bytes[3] << 24)
        ) >>> 0;
    }
    const bytes = await ctx.readBytes(8);
    return (
        (bytes[0] +
            (bytes[1] << 8) +
            (bytes[2] << 16) +
            (bytes[3] << 24)) >>> 0 +
        (bytes[4] * 2 ** 32) +
        (bytes[5] * 2 ** 40) +
        (bytes[6] * 2 ** 48) +
        (bytes[7] * 2 ** 56)
    );
}
