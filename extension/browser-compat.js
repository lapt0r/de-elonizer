// Provide `browser` on Chrome/Edge where only `chrome` exists (MV3, Chrome 98+).
if (typeof globalThis.browser === 'undefined') globalThis.browser = globalThis.chrome;
