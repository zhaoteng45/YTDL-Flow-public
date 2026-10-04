/** Settings reads share the same native tool lock: never inspect while reading versions. */
export function createToolOperationQueue() {
    let tail: Promise<unknown> = Promise.resolve();
    const pending = new Map<string, Promise<unknown>>();
    return function run<T>(key: string, operation: () => Promise<T>): Promise<T> {
        const existing = pending.get(key);
        if (existing) return existing as Promise<T>;
        const result = tail.then(operation);
        pending.set(key, result);
        tail = result.then(() => { pending.delete(key); }, () => { pending.delete(key); });
        return result;
    };
}

export function toolVersionDisplay(value: string) {
    const full = value.trim();
    const available = Boolean(full) && !['unknown', 'not found'].includes(full.toLowerCase());
    // Upstream FFmpeg appends build provenance; retain it for disclosure/copy.
    const label = available ? full.replace(/-(?:essentials|full|release)_build.*$/, '') : full;
    return { available, label, full };
}
