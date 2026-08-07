/**
 * Li-Fi Binary Encoding/Decoding Utilities
 * Handles file-to-binary and binary-to-file conversion
 */

const MAGIC_SYNC = 0xdeadbeef; // 32-bit magic sync

// Frames of throwaway alternating black/white sent right after the purple start marker,
// before the real header. Right as the screen jumps from the (dark) purple marker to
// bright white, the camera's auto-exposure hasn't caught up yet, so genuine white frames
// can misread as dim for the first several frames. This lets the exposure settle on
// throwaway data instead of on the magic header, which would corrupt the whole decode.
export const WARMUP_FRAMES = 15;

export interface EncodeResult {
  bits: boolean[];
  originalLength: number;
}

export interface DecodeResult {
  success: boolean;
  data: Uint8Array | null;
  bitsReceived: number;
  error?: string;
}

/**
 * Encode a file into a bitstream with header.
 * Framing (start/end of transmission) is handled separately by the purple
 * marker frames in the send/receive pages — this only covers the payload.
 * Format: [MAGIC (32 bits)] [LENGTH (32 bits)] [FILE_DATA]
 */
export function encodeFile(file: File): Promise<EncodeResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer;
      const fileData = new Uint8Array(buffer);
      const fileLength = fileData.length;

      const bits: boolean[] = [];

      // 1. Add magic sync (32 bits)
      for (let i = 31; i >= 0; i--) {
        bits.push(((MAGIC_SYNC >> i) & 1) === 1);
      }

      // 2. Add length header (32 bits, big-endian)
      for (let i = 31; i >= 0; i--) {
        bits.push(((fileLength >> i) & 1) === 1);
      }

      // 3. Add file data (8 bits per byte)
      for (let byte of fileData) {
        for (let i = 7; i >= 0; i--) {
          bits.push(((byte >> i) & 1) === 1);
        }
      }

      resolve({ bits, originalLength: fileLength });
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Decode bits into a file
 * Extracts: MAGIC, LENGTH, and FILE_DATA
 * Returns the reconstructed Uint8Array
 */
export function decodeBits(bits: boolean[]): DecodeResult {
  // 1. Read magic (32 bits)
  if (bits.length < 32) {
    return {
      success: false,
      data: null,
      bitsReceived: bits.length,
      error: 'Not enough bits for magic',
    };
  }

  let magic = 0;
  for (let i = 0; i < 32; i++) {
    magic = (magic << 1) | (bits[i] ? 1 : 0);
  }

  if (magic !== MAGIC_SYNC) {
    return {
      success: false,
      data: null,
      bitsReceived: bits.length,
      error: `Magic mismatch: got 0x${magic.toString(16)}, expected 0x${MAGIC_SYNC.toString(16)}`,
    };
  }

  // 2. Read length (32 bits)
  if (bits.length < 64) {
    return {
      success: false,
      data: null,
      bitsReceived: bits.length,
      error: 'Not enough bits for length',
    };
  }

  let fileLength = 0;
  for (let i = 0; i < 32; i++) {
    fileLength = (fileLength << 1) | (bits[32 + i] ? 1 : 0);
  }

  // 3. Read file data
  const fileStart = 64;
  const fileBits = bits.slice(fileStart, fileStart + fileLength * 8);

  if (fileBits.length < fileLength * 8) {
    return {
      success: false,
      data: null,
      bitsReceived: bits.length,
      error: `Incomplete file data: got ${fileBits.length} bits, need ${fileLength * 8}`,
    };
  }

  // Convert bits to bytes
  const data = new Uint8Array(fileLength);
  for (let i = 0; i < fileLength; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | (fileBits[i * 8 + j] ? 1 : 0);
    }
    data[i] = byte;
  }

  return {
    success: true,
    data,
    bitsReceived: fileStart + fileLength * 8,
  };
}

/**
 * Create a downloadable blob from binary data
 */
export function createBlob(data: Uint8Array): Blob {
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type: 'application/octet-stream' });
}

/**
 * Trigger browser download
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Extract filename from File object or generate default
 */
export function getFilenameForDownload(originalName: string): string {
  return originalName || 'download.bin';
}
