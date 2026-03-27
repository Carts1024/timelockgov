export function encodeTextToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function decodeBytesToText(value: Uint8Array | string): string {
  if (typeof value === "string") {
    if (isHexString(value)) {
      try {
        return new TextDecoder().decode(hexToBytes(value));
      } catch {
        return value;
      }
    }

    return value;
  }

  try {
    return new TextDecoder().decode(value);
  } catch {
    return "<invalid utf8>";
  }
}

function isHexString(input: string): boolean {
  return input.length > 0 && input.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(input);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);

  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }

  return bytes;
}
