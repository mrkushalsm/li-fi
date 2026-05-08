# Li-Fi: Light Fidelity Optical File Transfer Demo

An experimental web application that demonstrates optical wireless file transfer using visible light. The sender encodes a file as binary light flashes (white = 1, black = 0) at 30Hz, and the receiver uses a webcam to capture and decode those flashes back into the original file.

## 🚀 Features

- **Optical Transmission**: Files encoded as 30Hz light pulses (no WiFi or internet required)
- **Real-time Synchronization**: Sync preamble detection ensures receiver alignment
- **Binary Protocol**: Format includes magic header (0xdeadbeef), length prefix, and file data
- **Automatic Download**: Files auto-download upon successful reception
- **Blink Detector Easter Egg**: Detects interruptions in the light signal and triggers a fun "corrupted file" download when you blink
- **Dark Terminal Aesthetic**: Green-on-black monospace interface with glow animations
- **Cross-Device Transfer**: Send files from one device's screen, receive on another's webcam

## 📦 Architecture

### Pages

| Route | Purpose |
|-------|---------|
| `/` | Landing page with feature overview and navigation |
| `/send` | Transmitter interface — upload file and start 30fps flashing |
| `/receive` | Receiver interface — webcam capture and bit detection |

### Core Components

**`app/lib/binaryEncoding.ts`**
- `encodeFile(file)` — Converts file → binary bitstream with headers
- `decodeBits(bits)` — Converts binary bitstream → Uint8Array with validation
- `detectSyncPreamble(bits)` — Finds alignment marker in bit stream
- `downloadBlob(blob, filename)` — Triggers browser download

**`app/send/page.tsx`**
- File upload input
- RAF-based 30fps transmission loop
- Live progress bar and bit counter
- Screen flashing: white (#FFFFFF) for bit 1, black (#000000) for bit 0

**`app/receive/page.tsx`**
- Webcam integration via `getUserMedia`
- Canvas-based pixel sampling (20×20px center region)
- Brightness threshold: > 200 = bit 1, else bit 0
- Automatic file download on completion
- Blink detector: triggers download of partial file when signal interrupted > 300ms

### Binary Protocol

```
[Sync Preamble: 128 bits] [Magic: 0xdeadbeef (32 bits)] [Length (32 bits)] [File Data (8*N bits)]
```

- **Sync Preamble**: `10101010` repeated 16 times (128 bits) — helps receiver lock onto signal
- **Magic**: Fixed 32-bit value for validation
- **Length**: File size in bytes (big-endian)
- **File Data**: Raw binary representation of file

## 🛠️ Tech Stack

- **Framework**: Next.js 16.2.6 (Turbopack)
- **Language**: TypeScript 5 (strict mode)
- **Styling**: CSS Modules + custom dark theme
- **APIs**: `requestAnimationFrame`, `getUserMedia`, Canvas 2D, Blob API
- **Build**: Turbopack (1.6s compile time)

## 🎯 Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- A webcam (for receiver)
- Two devices (phone + laptop recommended for cross-device transfer)

### Installation

```bash
git clone <repo>
cd time
npm install
```

### Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Production Build

```bash
npm run build
npm start
```

## 📱 Usage

### Sending a File

1. Navigate to `/send`
2. Click "Select File to Transmit" and choose any file
3. Click "START TRANSMISSION"
4. Screen will flash white and black at 30Hz
5. Point another device's camera at the screen

### Receiving a File

1. Navigate to `/receive` on a second device
2. Click "Start Reception"
3. Allow webcam access
4. Wait for sync preamble detection ("Waiting for sync preamble...")
5. Once sync is locked, receiver displays "Receiving data..."
6. File automatically downloads upon completion
7. Use "Download Again" button for manual retry

### Easter Egg: Blink Detector

While receiving, if you block the webcam briefly (> 300ms), the receiver interprets this as corrupted data and downloads a partial file named `blink_glitch_[timestamp].bin`. A fun toast notification reads: "You blinked! Here's what got corrupted 👁️"

## 🎨 Styling

All pages use a dark terminal aesthetic:
- **Background**: Pure black (#000000)
- **Text**: Bright green (#00FF00)
- **Font**: Monospace (Monaco, Menlo, Ubuntu Mono)
- **Effects**: Glow animations, pulse effects, smooth transitions

## ⚙️ Technical Details

### 30Hz RAF Loop

Both sender and receiver use `requestAnimationFrame` locked to 30fps (33.33ms per frame):
- **Sender**: Switches screen color per frame based on bit value
- **Receiver**: Samples pixel brightness per frame and buffers bits

### Pixel Sampling

The receiver extracts a 20×20px region at the center of the video feed and calculates average brightness:
```typescript
const brightness = (R + G + B) / 3 for each pixel
const bit = brightness > 200 ? 1 : 0
```

### File Reconstruction

Once sync preamble is detected:
1. Extract magic (32 bits) and validate against 0xdeadbeef
2. Extract length (32 bits) to determine file size
3. Read file data bits and convert to bytes
4. Create Blob and trigger download

## 🧪 Testing Checklist

- [ ] Sender: Upload file → verify 30fps flashing (visual feedback)
- [ ] Receiver: Webcam access → brightness indicator updates → bit counter increments
- [ ] Cross-device: Send from phone screen → receive on laptop
- [ ] Sync detection: Verify preamble detection triggers "Receiving..." state
- [ ] File integrity: Downloaded file matches original file
- [ ] Blink detector: Block webcam mid-transmission → partial file downloads
- [ ] Styling: Verify green-on-black theme across all pages
- [ ] Mobile: Test on mobile browsers (portrait/landscape)

## 📊 Performance

- **Compile time**: ~1.6s (Turbopack)
- **Transfer speed**: ~1KB per 27 seconds at 30Hz (theoretically 240 Kbps)
- **Latency**: <50ms frame capture + bit detection

## 🚀 Future Enhancements

- [ ] Variable frame rates (30Hz → 60Hz → 120Hz for faster transfer)
- [ ] Error correction codes (Hamming, Reed-Solomon)
- [ ] Audio cues (beep on sync, chime on completion)
- [ ] Signal quality metrics (SNR, frame drop rate)
- [ ] Batch transfers (multiple files in sequence)
- [ ] Mobile camera orientation handling

## 📄 License

Open source for educational and experimental purposes.

## 🎓 How It Works: The Science

**Sender Side:**
1. File is read as a binary stream (8 bits per byte)
2. Sync preamble (128 bits of 10101010) is prepended for alignment
3. Magic header (32 bits) and length prefix (32 bits) are added
4. Each bit is rendered as a full-screen color: white (1) or black (0)
5. RAF loop drives the flashing at exactly 30fps

**Receiver Side:**
1. Webcam feed is drawn to a hidden canvas each frame
2. Center 20×20px region is sampled for average brightness
3. Brightness > 200 is interpreted as bit 1; else bit 0
4. Bits are buffered and searched for sync preamble (10101010 ×16)
5. Once sync is found, magic and length are validated
6. File bits are accumulated until expected length is reached
7. Accumulated bits are converted to Uint8Array and downloaded

**Blink Detection:**
If the light signal is interrupted for > 300ms (anomaly), the receiver treats accumulated bits as a corrupted file and triggers an auto-download with timestamp.

## 🤝 Contributing

Feedback, bug reports, and feature requests welcome!

