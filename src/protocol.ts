/** Validated JSON readers for the version-bound Harness HTTP and mux protocol. */
export type RecordValue = Record<string, unknown>;

/** @param value - JSON input. @returns Object fields, rejecting non-objects. */
export function record(value: unknown): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid protocol object');
  return value as RecordValue;
}

/** @param value - JSON input. @returns String field, rejecting other types. */
export function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid protocol string');
  return value;
}

/** @param value - JSON input. @returns Array field, rejecting other types. */
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Invalid protocol array');
  return value;
}

/** @param value - JSON input. @returns Safe sequence number. */
export function sequence(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < -1) throw new Error('Invalid protocol sequence');
  return value as number;
}

/** @param value - Launch URL entered by the user or read from the owned process. @returns Local authenticated URL. */
export function launchUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/' || url.username || url.password || !url.searchParams.get('token')) {
    throw new Error('Expected a loopback HTTP launch URL with ?token=…');
  }
  return url;
}

/** @param value - Process diagnostic. @returns Diagnostic with launch credentials removed. */
export function redact(value: string): string {
  return value.replace(/([?&]token=)[^\s&#"'<>]+/gi, '$1[redacted]');
}

/** @param value - Server envelope. @param rpcId - Expected correlation. @returns Successful payload or throws the server error. */
export function rpcResult(value: unknown, rpcId: string): unknown {
  const envelope = record(value);
  if (envelope.type !== 'server-response' || envelope.rpcId !== rpcId) throw new Error('Invalid RPC response correlation');
  const result = record(envelope.result);
  if (result.ok === true) return result.value;
  if (result.ok !== false) throw new Error('Invalid RPC result');
  const error = record(result.error);
  throw new Error(`${string(error.code)}: ${string(error.message)}`);
}
