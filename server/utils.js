// Returns a random element of `arr`, or undefined if it's empty.
export function randomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// Returns a shuffled copy of `arr` (Fisher-Yates).
export function shuffle(arr) {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}
