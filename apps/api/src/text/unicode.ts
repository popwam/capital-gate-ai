export function decodeUtf8(buffer: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
}
