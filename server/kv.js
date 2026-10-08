// Reads a JSON value from the CFBD_CACHE KV namespace. Returns null if the key is missing.
export async function kvGet(key, env) {
    return env.CFBD_CACHE.get(key, { type: 'json' });
}

// Writes a JSON value to the CFBD_CACHE KV namespace and stores it for `ttl` seconds (default 1 hour).
// (KV requires a minimum of 60 seconds for expirationTtl).
export async function kvPut(key, value, env, ttl = 3600) {
    await env.CFBD_CACHE.put(
        key,
        JSON.stringify(value), {
            expirationTtl: ttl
        }
    );
}
