
if (!(Map.prototype as any).getOrInsertComputed) {
    Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
        value: function (key: any, factory: () => any) {
            if (!this.has(key)) {
                this.set(key, factory())
            }
            return this.get(key)
        },
        configurable: true,
        writable: true
    })
}