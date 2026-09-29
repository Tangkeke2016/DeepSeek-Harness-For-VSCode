/** Backend HTTP uses Node sockets rather than VS Code's Electron-backed global fetch. */
import { fetch as nodeFetch } from 'undici';

/** Fetch-compatible backend transport; does not replace globals used by other extensions. */
export const backendFetch = nodeFetch as typeof globalThis.fetch;
