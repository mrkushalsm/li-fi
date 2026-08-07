/**
 * Li-Fi Binary Encoding/Decoding Utilities
 * Handles file-to-binary and binary-to-file conversion
 */

const MAGIC_SYNC = 0xdeadbeef; // 32-bit magic sync
const SYNC_PREAMBLE = 0xaa; // 10101010 pattern for alignment

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
 * Generate sync preamble pattern (10101010 repeated N times)
 * Used to help receiver align with transmission
 */
export function generateSyncPreamble(repeatCount: number = 16): boolean[] {
  const bits: boolean[] = [];
  for (let i = 0; i < repeatCount; i++) {
    bits.push(true);  // 1
    bits.push(false); // 0
    bits.push(true);  // 1
    bits.push(false); // 0
    bits.push(true);  // 1
    bits.push(false); // 0
    bits.push(true);  // 1
    bits.push(false); // 0
  }
  return bits;
}

/**
 * Encode a file into a bitstream with header
 * Format: [SYNC_PREAMBLE (128 bits)] [MAGIC (32 bits)] [LENGTH (32 bits)] [FILE_DATA]
 */
export function encodeFile(file: File): Promise<EncodeResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer;
      const fileData = new Uint8Array(buffer);
      const fileLength = fileData.length;

      const bits: boolean[] = [];

      // 1. Add sync preamble (128 bits = 16 bytes of 10101010)
      bits.push(...generateSyncPreamble(16));

      // 2. Add magic sync (32 bits)
      for (let i = 31; i >= 0; i--) {
        bits.push(((MAGIC_SYNC >> i) & 1) === 1);
      }

      // 3. Add length header (32 bits, big-endian)
      for (let i = 31; i >= 0; i--) {
        bits.push(((fileLength >> i) & 1) === 1);
      }

      // 4. Add file data (8 bits per byte)
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
 * Detect sync preamble in bit stream (find 10101010 pattern)
 * Returns index where sync ends, or -1 if not found
 */
export function detectSyncPreamble(bits: boolean[]): number {
  const PREAMBLE_LENGTH = 128;
  if (bits.length < PREAMBLE_LENGTH) return -1; // Need at least 128 bits for full preamble

  for (let i = 0; i <= bits.length - PREAMBLE_LENGTH; i++) {
    let matches = true;
    for (let k = 0; k < PREAMBLE_LENGTH; k++) {
      // Alternating pattern starting with 1: bit at offset k should be true when k is even
      if (bits[i + k] !== (k % 2 === 0)) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return i + PREAMBLE_LENGTH; // Return position after preamble
    }
  }

  return -1;
}

/**
 * Decode bits into a file
 * Extracts: MAGIC, LENGTH, and FILE_DATA
 * Returns the reconstructed Uint8Array
 */
export function decodeBits(bits: boolean[]): DecodeResult {
  // 1. Find sync preamble
  const syncIndex = detectSyncPreamble(bits);
  if (syncIndex === -1) {
    return {
      success: false,
      data: null,
      bitsReceived: bits.length,
      error: 'Sync preamble not found',
    };
  }

  const dataStart = syncIndex;

  // 2. Read magic (32 bits)
  if (bits.length < dataStart + 32) {
    return {
      success: false,
      data: null,
      bitsReceived: bits.length,
      error: 'Not enough bits for magic',
    };
  }

  let magic = 0;
  for (let i = 0; i < 32; i++) {
    magic = (magic << 1) | (bits[dataStart + i] ? 1 : 0);
  }

  if (magic !== MAGIC_SYNC) {
    return {
      success: false,
      data: null,
      bitsReceived: bits.length,
      error: `Magic mismatch: got 0x${magic.toString(16)}, expected 0x${MAGIC_SYNC.toString(16)}`,
    };
  }

  // 3. Read length (32 bits)
  if (bits.length < dataStart + 64) {
    return {
      success: false,
      data: null,
      bitsReceived: bits.length,
      error: 'Not enough bits for length',
    };
  }

  let fileLength = 0;
  for (let i = 0; i < 32; i++) {
    fileLength = (fileLength << 1) | (bits[dataStart + 32 + i] ? 1 : 0);
  }

  // 4. Read file data
  const fileStart = dataStart + 64;
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

/**
 * Detect transmission terminator (16 consecutive 1s after valid file data)
 * Returns true if terminator pattern found at the start of the provided bits
 */
export function detectTerminator(bits: boolean[]): boolean {
  if (bits.length < 16) return false;
  
  // Check if the FIRST 16 bits are all true (terminator signal)
  for (let i = 0; i < 16; i++) {
    if (!bits[i]) return false; // If any bit is false, no terminator
  }
  
  return true;
}

/**
 * Generate transmission terminator (16 consecutive 1s to signal end)
 */
export function generateTerminator(): boolean[] {
  return new Array(16).fill(true);
}
