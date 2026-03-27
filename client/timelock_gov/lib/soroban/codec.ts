export function encodeTextToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function decodeBytesToText(value: Uint8Array | string): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return new TextDecoder().decode(value);
  } catch {
    return "<invalid utf8>";
  }
}
