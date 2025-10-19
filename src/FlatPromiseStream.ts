const _undefined = Symbol("_undefined");

export default class FlatPromiseStream<T> implements PromiseLike<T> {
    private _resolvers: Array<(value: T) => void> = [];
    private _rejectors: Array<(reason?: any) => void> = [];
    private _results: ([typeof _undefined, T] | [any])[] = [];

    resolve(value: T) {
        let done = false;
        for (const resolver of this._resolvers.splice(0)) {
            resolver(value);
            done = true;
        }
        if (!done) {
            this._results.push([_undefined, value]);
        }
        this._rejectors = [];
    }

    reject(reason?: any) {
        let done = false;
        for (const rejector of this._rejectors.splice(0)) {
            rejector(reason);
            done = true;
        }
        if (!done) {
            this._results.push([reason]);
        }
        this._resolvers = [];
    }

    then<TResult1 = T, TResult2 = never>(
        onfulfilled?:
            | ((value: T) => TResult1 | PromiseLike<TResult1>)
            | undefined
            | null,
        onrejected?:
            | ((reason: any) => TResult2 | PromiseLike<TResult2>)
            | undefined
            | null,
    ): Promise<TResult1 | TResult2> {
        const result = this._results.shift();
        if (result) {
            const [errOrVal, valIfNotErr] = result;

            if (errOrVal === _undefined) {
                // Handle if the result is T
                const val = valIfNotErr as T;
                if (onfulfilled) {
                    try {
                        return Promise.resolve(onfulfilled(val));
                    } catch (err) {
                        return Promise.reject(err);
                    }
                } else {
                    return Promise.resolve(val as any);
                }
            }

            // Handle if the result is an error
            return Promise.reject(errOrVal);
        }

        return new Promise<TResult1 | TResult2>((resolve, reject) => {
            if (onfulfilled) {
                this._resolvers.push((value: T) => {
                    try {
                        resolve(onfulfilled(value));
                    } catch (err) {
                        reject(err);
                    }
                });
            } else {
                this._resolvers.push((value: T) => {
                    resolve(value as any);
                });
            }

            if (onrejected) {
                this._rejectors.push((reason: any) => {
                    try {
                        resolve(onrejected(reason));
                    } catch (err) {
                        reject(err);
                    }
                });
            } else {
                this._rejectors.push((reason: any) => {
                    reject(reason);
                });
            }
        });
    }
}
