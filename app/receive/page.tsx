'use client';

import { useState, useRef, useEffect } from 'react';
import { decodeBits, createBlob, downloadBlob, detectSyncPreamble } from '@/app/lib/binaryEncoding';
import styles from './receive.module.css';

type ReceiverState = 'idle' | 'waiting' | 'syncing' | 'receiving' | 'complete' | 'error';

export default function ReceivePage() {
  const [state, setState] = useState<ReceiverState>('idle');
  const [bits, setBits] = useState<boolean[]>([]);
  const [displayBrightness, setDisplayBrightness] = useState(128);
  const [status, setStatus] = useState('Ready to receive');
  const [error, setError] = useState('');
  const [receivedFile, setReceivedFile] = useState<{ name: string; size: number } | null>(null);
  const [bitsReceived, setBitsReceived] = useState(0);

  // Blink detector state
  const [blinkDetected, setBlinkDetected] = useState(false);
  const [blinkMessage, setBlinkMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const lastBrightnessRef = useRef<number[]>([128]); // Keep track of recent brightness values
  const darkIntervalRef = useRef(0); // Track how long the signal has been dark
  const lastFrameTimeRef = useRef(performance.now());

  /**
   * Initialize webcam
   */
  const initWebcam = async () => {
    try {
      setError('');
      setState('waiting');
      setStatus('Initializing webcam...');

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setState('syncing');
          setStatus('Waiting for sync preamble...');
          startReception();
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(`Webcam access failed: ${message}`);
      setState('error');
      setStatus('Failed to access webcam');
    }
  };

  /**
   * RAF-based reception at 30fps
   */
  const startReception = () => {
    const frameInterval = 1000 / 30; // ~33.33ms per frame

    const receive = (currentTime: number) => {
      const elapsed = currentTime - lastFrameTimeRef.current;

      if (elapsed >= frameInterval) {
        const brightness = samplePixelBrightness();
        const bit = brightness > 200; // Threshold

        // Update display
        setDisplayBrightness(brightness);

        // Add to bits
        const newBits = [...bits, bit];
        setBits(newBits);
        setBitsReceived(newBits.length);

        // Update brightness history
        lastBrightnessRef.current = [
          ...lastBrightnessRef.current.slice(-9),
          brightness,
        ];

        // Detect sync preamble
        if (state === 'syncing' && newBits.length >= 128) {
          const syncIndex = detectSyncPreamble(newBits);
          if (syncIndex !== -1) {
            setState('receiving');
            setStatus('Receiving data...');
          }
        }

        // Blink detection: look for long dark intervals inconsistent with data
        if (state === 'receiving' && brightness < 100) {
          darkIntervalRef.current += frameInterval;

          // A dark interval > 200ms that isn't a normal 0-bit sequence suggests a blink
          if (darkIntervalRef.current > 200 && newBits.length > 128) {
            // Check if this is a valid data pause (0-bits are short, ~33ms each)
            // A blink is an anomaly: 200ms+ of darkness
            if (darkIntervalRef.current > 300) {
              triggerBlinkDetection(newBits);
            }
          }
        } else {
          darkIntervalRef.current = 0;
        }

        // Try to decode
        if (state === 'receiving' && newBits.length >= 128 + 32 + 32) {
          const decoded = decodeBits(newBits);
          if (decoded.success && decoded.data) {
            completeReception(decoded.data, newBits);
          }
        }

        lastFrameTimeRef.current = currentTime;
      }

      rafRef.current = requestAnimationFrame(receive);
    };

    rafRef.current = requestAnimationFrame(receive);
  };

  /**
   * Sample center pixel brightness
   */
  const samplePixelBrightness = (): number => {
    if (!videoRef.current || !canvasRef.current) return 128;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return 128;

    const video = videoRef.current;
    canvasRef.current.width = video.videoWidth;
    canvasRef.current.height = video.videoHeight;

    if (canvasRef.current.width === 0 || canvasRef.current.height === 0) return 128;

    ctx.drawImage(video, 0, 0);

    // Sample a 20x20 region at center
    const centerX = (canvasRef.current.width / 2) | 0;
    const centerY = (canvasRef.current.height / 2) | 0;
    const sampleSize = 20;
    const x = Math.max(0, centerX - sampleSize / 2);
    const y = Math.max(0, centerY - sampleSize / 2);

    const imageData = ctx.getImageData(x, y, sampleSize, sampleSize);
    const data = imageData.data;

    // Calculate average brightness
    let totalBrightness = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      totalBrightness += (r + g + b) / 3;
    }

    return Math.round(totalBrightness / (imageData.data.length / 4));
  };

  /**
   * Handle blink detection
   */
  const triggerBlinkDetection = (currentBits: boolean[]) => {
    const decoded = decodeBits(currentBits);

    // Create corrupted file from whatever we have
    if (decoded.data && decoded.data.length > 0) {
      const blob = createBlob(decoded.data);
      const timestamp = Date.now();
      downloadBlob(blob, `blink_glitch_${timestamp}.bin`);

      setBlinkDetected(true);
      setBlinkMessage(`You blinked! Downloaded ${decoded.data.length} bytes of corrupted data 👁️`);
      setToastVisible(true);

      // Hide toast after 5 seconds
      setTimeout(() => setToastVisible(false), 5000);
    }
  };

  /**
   * Complete reception
   */
  const completeReception = (data: Uint8Array, allBits: boolean[]) => {
    setState('complete');
    setStatus('✓ Reception complete!');
    setReceivedFile({
      name: 'received_file.bin',
      size: data.length,
    });

    // Auto-download
    const blob = createBlob(data);
    downloadBlob(blob, 'received_file.bin');

    // Stop RAF
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
  };

  /**
   * Stop reception
   */
  const handleStop = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
    }

    setState('idle');
    setBits([]);
    setBitsReceived(0);
    setStatus('Ready to receive');
    setReceivedFile(null);
  };

  /**
   * Manual download retry
   */
  const handleRetryDownload = () => {
    if (bits.length > 0) {
      const decoded = decodeBits(bits);
      if (decoded.data) {
        const blob = createBlob(decoded.data);
        downloadBlob(blob, 'received_file.bin');
      }
    }
  };

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <h1>Li-Fi Receiver</h1>

        <div className={styles.videoSection}>
          <video
            ref={videoRef}
            className={styles.video}
            style={{ display: state !== 'idle' ? 'block' : 'none' }}
            autoPlay
            playsInline
          />

          {state === 'idle' && (
            <div className={styles.placeholder}>
              <p>📹 Ready to receive</p>
            </div>
          )}
        </div>

        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {/* Display brightness indicator */}
        {state !== 'idle' && (
          <div className={styles.brightnessIndicator}>
            <div
              className={styles.brightnessBox}
              style={{
                backgroundColor: `rgb(${displayBrightness}, ${displayBrightness}, ${displayBrightness})`,
              }}
            />
            <span>{displayBrightness}</span>
          </div>
        )}

        {/* Status and controls */}
        <div className={styles.statusSection}>
          <div className={styles.status}>{status}</div>
          <div className={styles.bitCount}>
            Received: {bitsReceived.toLocaleString()} bits
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.buttonGroup}>
            {state === 'idle' && (
              <button onClick={initWebcam} className={styles.startButton}>
                Start Reception
              </button>
            )}

            {state !== 'idle' && state !== 'complete' && state !== 'error' && (
              <button onClick={handleStop} className={styles.stopButton}>
                Stop
              </button>
            )}

            {state === 'complete' && (
              <>
                <button onClick={handleRetryDownload} className={styles.retryButton}>
                  Download Again
                </button>
                <button onClick={handleStop} className={styles.resetButton}>
                  Reset
                </button>
              </>
            )}
          </div>

          {receivedFile && (
            <div className={styles.fileInfo}>
              ✓ {receivedFile.name} ({(receivedFile.size / 1024).toFixed(2)} KB)
            </div>
          )}
        </div>

        {/* Blink detector toast */}
        {toastVisible && (
          <div className={styles.toast}>
            <span>{blinkMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
}
