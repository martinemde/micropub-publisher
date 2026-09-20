/** A Durable Object owns these cached maps; every explicit mutation also writes storage. */
export class DurableState {
  #maps = new Map();
  constructor(storage) {
    this.storage = storage;
  }
  getMap(name) {
    if (!this.#maps.has(name)) {
      this.#maps.set(name, new DurableMap(this.storage.kv, `${name}:`));
    }
    return this.#maps.get(name);
  }
}

class DurableMap extends Map {
  constructor(kv, prefix) {
    super();
    this.kv = kv;
    this.prefix = prefix;
    for (const [key, value] of kv.list({ prefix })) {
      super.set(key.slice(prefix.length), value);
    }
  }
  set(key, value) {
    this.kv.put(this.prefix + key, value);
    return super.set(key, value);
  }
  delete(key) {
    this.kv.delete(this.prefix + key);
    return super.delete(key);
  }
  clear() {
    for (const key of this.keys()) this.delete(key);
  }
}
