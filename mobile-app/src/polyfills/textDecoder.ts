/**
 * No se importa desde `index.ts`: reemplazar `globalThis.TextDecoder` en arranque rompía el runtime
 * en algunos dispositivos/Hermes. Si hace falta utf-16le, importar este módulo solo donde aplique.
 */
type DecoderInput = ArrayBuffer | ArrayBufferView | null | undefined;

function toUint8Array(input: DecoderInput): Uint8Array {
  if (!input) return new Uint8Array(0);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

function decodeUtf16Le(input: DecoderInput): string {
  const bytes = toUint8Array(input);
  const codeUnitsLength = Math.floor(bytes.length / 2);
  if (codeUnitsLength === 0) return '';

  // Decode in chunks to avoid "Maximum call stack size exceeded".
  const CHUNK = 8192;
  let result = '';
  for (let i = 0; i < codeUnitsLength; i += CHUNK) {
    const end = Math.min(i + CHUNK, codeUnitsLength);
    const units = new Array<number>(end - i);
    for (let j = i; j < end; j++) {
      const offset = j * 2;
      units[j - i] = bytes[offset] | (bytes[offset + 1] << 8);
    }
    result += String.fromCharCode(...units);
  }
  return result;
}

export function installTextDecoderUtf16LePolyfill(): void {
  const NativeTextDecoder = globalThis.TextDecoder as any;
  if (typeof NativeTextDecoder !== 'function') return;

  try {
    // If runtime already supports utf-16le, do nothing.
    new NativeTextDecoder('utf-16le');
    return;
  } catch {
    // Continue and patch below.
  }

  class PatchedTextDecoder {
    private readonly normalizedLabel: string;
    private readonly nativeDecoder?: any;
    readonly fatal: boolean;
    readonly ignoreBOM: boolean;

    constructor(label = 'utf-8', options?: { fatal?: boolean; ignoreBOM?: boolean }) {
      const normalizedLabel = String(label).trim().toLowerCase();
      this.normalizedLabel = normalizedLabel;
      this.fatal = !!options?.fatal;
      this.ignoreBOM = !!options?.ignoreBOM;

      if (normalizedLabel === 'utf-16le' || normalizedLabel === 'utf-16') return;
      this.nativeDecoder = new NativeTextDecoder(label, options);
    }

    get encoding(): string {
      return this.normalizedLabel;
    }

    decode(input?: DecoderInput, options?: { stream?: boolean }): string {
      if (this.normalizedLabel === 'utf-16le' || this.normalizedLabel === 'utf-16') {
        return decodeUtf16Le(input);
      }
      if (!this.nativeDecoder) return '';
      return this.nativeDecoder.decode(input as any, options);
    }
  }

  (globalThis as any).TextDecoder = PatchedTextDecoder;
}
