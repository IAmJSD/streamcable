export class OutOfDataError extends Error {
    constructor() {
        super("Attempt to read past end of stream");
    }
}

export class ReadContext {
    private _slices: (Uint8Array | null)[] = [];
    private _pos = 0;
    private _promise: Promise<Uint8Array | null>;

    constructor(private reader: ReadableStreamDefaultReader<Uint8Array>) {
        const r = () =>
            this.reader.read().then(({ done, value }) => {
                if (done) {
                    this._slices.push(null);
                    return null;
                }
                this._slices.push(value!);
                this._promise = r();
                return value!;
            });
        this._promise = r();
    }

    async readByte(): Promise<number> {
        for (;;) {
            if (this._slices.length) {
                const slice = this._slices[0];
                if (slice === null) {
                    throw new OutOfDataError();
                }
                if (this._pos < slice.length) {
                    return slice[this._pos++];
                } else {
                    this._slices.shift();
                    this._pos = 0;
                }
            } else {
                break;
            }
        }

        const slice = await this._promise;
        if (slice === null) {
            throw new OutOfDataError();
        }
        this._pos = 1;
        if (slice[0] === undefined) {
            throw new OutOfDataError();
        }
        return slice[0];
    }

    async peekByte(): Promise<number> {
        for (;;) {
            if (this._slices.length) {
                const slice = this._slices[0];
                if (slice === null) {
                    throw new OutOfDataError();
                }
                if (this._pos < slice.length) {
                    return slice[this._pos];
                } else {
                    this._slices.shift();
                    this._pos = 0;
                }
            } else {
                break;
            }
        }

        const slice = await this._promise;
        if (slice === null) {
            throw new OutOfDataError();
        }
        this._pos = 0;
        if (slice[0] === undefined) {
            throw new OutOfDataError();
        }
        return slice[0];
    }

    async readBytes(len: number): Promise<Uint8Array> {
        const result = new Uint8Array(len);
        let offset = 0;
        while (offset < len) {
            for (;;) {
                if (this._slices.length) {
                    const slice = this._slices[0];
                    if (slice === null) {
                        throw new OutOfDataError();
                    }
                    const toCopy = Math.min(
                        len - offset,
                        slice.length - this._pos,
                    );
                    result.set(
                        slice.subarray(this._pos, this._pos + toCopy),
                        offset,
                    );
                    this._pos += toCopy;
                    offset += toCopy;
                    if (this._pos >= slice.length) {
                        this._slices.shift();
                        this._pos = 0;
                    }
                    if (offset >= len) {
                        break;
                    }
                } else {
                    break;
                }
            }
            if (offset >= len) {
                break;
            }
            const slice = await this._promise;
            if (slice === null) {
                throw new OutOfDataError();
            }
            this._pos = 0;
        }
        return result;
    }
}
