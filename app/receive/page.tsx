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
  const [countdown, setCountdown] = useState(3); // Countdown timer (3 seconds)

  // Blink detector state
  const [blinkDetected, setBlinkDetected] = useState(false);
  const [blinkMessage, setBlinkMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);

  // Debug display state
  const [debugColor, setDebugColor] = useState('rgb(128, 128, 128)');
  const [debugRgb, setDebugRgb] = useState('R:128 G:128 B:128');
  const [debugPurpleDetected, setDebugPurpleDetected] = useState(false);
  const [debugPurpleStreak, setDebugPurpleStreak] = useState(0);
  const [debugShowPanel, setDebugShowPanel] = useState(true);
  const [debugThresholds, setDebugThresholds] = useState('—');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const countdownTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const lastBrightnessRef = useRef<number[]>([128]); // Keep track of recent brightness values
  const darkIntervalRef = useRef(0); // Track how long the signal has been dark
  const lastFrameTimeRef = useRef(performance.now());
  const stateRef = useRef<ReceiverState>('idle'); // Track state changes in RAF loop
  const bitsRef = useRef<boolean[]>([]); // Track bits array in RAF loop
  const fileDecodedRef = useRef(false); // Track if we've already decoded a file
  const decodedFileRef = useRef<Uint8Array | null>(null); // Cache decoded payload until the purple end marker arrives
  const purpleStreakRef = useRef(0); // Count consecutive purple frames

  const isBinaryWhiteFrame = (brightness: number, red: number, green: number, blue: number) => {
    return brightness >= 220 && red >= 200 && green >= 200 && blue >= 200;
  };

  const isPurpleEndFrame = (red: number, green: number, blue: number) => {
    // Expected purple: RGB(179, 0, 255) = #b300ff
    const check1 = red >= 110;
    const check2 = blue >= 110;
    const check3 = green <= 170;
    const check4 = red + blue >= green * 2;
    const isPurple = check1 && check2 && check3 && check4;

    if (red > 50 || blue > 50) {
      const checkStatus = `R≥110:${check1 ? '✓' : '✗'} B≥110:${check2 ? '✓' : '✗'} G≤170:${check3 ? '✓' : '✗'} R+B≥G*2:${check4 ? '✓' : '✗'}`;
      console.log(`[RGB] R:${red} G:${green} B:${blue} → ${checkStatus}`);
      return { isPurple, checkStatus };
    }
    return { isPurple, checkStatus: '—' };
  };

  /**
   * Initialize webcam
   */
  const initWebcam = async () => {
    try {
      setError('');
      setState('waiting');
      stateRef.current = 'waiting';
      setStatus('Initializing webcam...');

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          stateRef.current = 'syncing';
          bitsRef.current = [];
          fileDecodedRef.current = false;
          decodedFileRef.current = null;
          purpleStreakRef.current = 0;
          setCountdown(3); // Start 3-second countdown
          setState('syncing');
          setStatus('Prepare camera');
          
          // Countdown timer
          let count = 3;
          if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
          
          countdownTimerRef.current = setInterval(() => {
            count--;
            if (count >= 0) {
              setCountdown(count);
            } else {
              // Countdown complete, start reception
              if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
              setCountdown(-1); // Hide countdown text
              setStatus('Waiting for sync preamble...');
              startReception();
            }
          }, 1000);
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(`Webcam access failed: ${message}`);
      stateRef.current = 'error';
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
        const color = samplePixelColor();
        const brightness = color.brightness;
        const purpleCheck = isPurpleEndFrame(color.red, color.green, color.blue);
        const purpleFrame = purpleCheck.isPurple;

        // Update display
        setDisplayBrightness(brightness);
        setDebugRgb(`R:${color.red} G:${color.green} B:${color.blue}`);
        setDebugColor(`rgb(${color.red}, ${color.green}, ${color.blue})`);
        setDebugThresholds(purpleCheck.checkStatus);

        if (stateRef.current === 'receiving' && fileDecodedRef.current && decodedFileRef.current && purpleFrame) {
          setDebugPurpleDetected(true);
          purpleStreakRef.current += 1;
          setDebugPurpleStreak(purpleStreakRef.current);
          console.log(`[Receiver] Purple frame detected! Streak: ${purpleStreakRef.current}/4`);
          setStatus('END SIGNAL DETECTED...');

          if (purpleStreakRef.current >= 4) {
            console.log('[Receiver] ✓ Purple end marker confirmed (4 frames). Completing reception.');
            completeReception(decodedFileRef.current, bitsRef.current);
          }

          lastFrameTimeRef.current = currentTime;
          rafRef.current = requestAnimationFrame(receive);
          return;
        } else if (stateRef.current === 'receiving' && fileDecodedRef.current && decodedFileRef.current && !purpleFrame) {
          setDebugPurpleDetected(false);
          setDebugPurpleStreak(0);
          console.log(`[Receiver] Waiting for purple end marker. RGB: (${color.red}, ${color.green}, ${color.blue})`);
        }

        purpleStreakRef.current = 0;

        if (fileDecodedRef.current) {
          lastFrameTimeRef.current = currentTime;
          rafRef.current = requestAnimationFrame(receive);
          return;
        }

        const bit = isBinaryWhiteFrame(brightness, color.red, color.green, color.blue);

        // Add to bits using ref
        bitsRef.current.push(bit);
        const newBits = bitsRef.current;
        setBits([...newBits]); // Update state for UI
        setBitsReceived(newBits.length);

        // Debug: log recent bits every 50 bits
        if (newBits.length % 50 === 0) {
          const recentBits = newBits.slice(-16).map(b => b ? '1' : '0').join('');
          console.log(`[Receiver] ${newBits.length} bits received. Last 16: ${recentBits}, RGB: ${color.red}/${color.green}/${color.blue}, State: ${stateRef.current}`);
        }

        // Update brightness history
        lastBrightnessRef.current = [
          ...lastBrightnessRef.current.slice(-9),
          brightness,
        ];

        // Detect sync preamble
        if (stateRef.current === 'syncing' && newBits.length >= 128) {
          const syncIndex = detectSyncPreamble(newBits);
          if (syncIndex !== -1) {
            console.log(`[Receiver] Sync preamble detected at index ${syncIndex}!`);
            stateRef.current = 'receiving';
            setState('receiving');
            setStatus('Receiving data...');
          }
        }

        // Blink detection: look for long dark intervals inconsistent with data
        if (stateRef.current === 'receiving' && brightness < 100) {
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
        if (stateRef.current === 'receiving' && newBits.length >= 128 + 32 + 32) {
          // Only decode if we haven't already successfully decoded
          if (!fileDecodedRef.current) {
            const decoded = decodeBits(newBits);
            if (decoded.success && decoded.data) {
              fileDecodedRef.current = true;
              decodedFileRef.current = decoded.data;
              console.log(`[Receiver] File decoded! Size: ${decoded.data.length} bytes. Waiting for purple end marker...`);
              setStatus('File received. Waiting for purple end signal...');
            }
          }
        }

        lastFrameTimeRef.current = currentTime;
      }

      rafRef.current = requestAnimationFrame(receive);
    };

    rafRef.current = requestAnimationFrame(receive);
  };

  /**
   * Sample center pixel color and brightness
   */
  const samplePixelColor = (): { brightness: number; red: number; green: number; blue: number } => {
    if (!videoRef.current || !canvasRef.current) {
      return { brightness: 128, red: 128, green: 128, blue: 128 };
    }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) {
      return { brightness: 128, red: 128, green: 128, blue: 128 };
    }

    const video = videoRef.current;
    canvasRef.current.width = video.videoWidth;
    canvasRef.current.height = video.videoHeight;

    if (canvasRef.current.width === 0 || canvasRef.current.height === 0) {
      return { brightness: 128, red: 128, green: 128, blue: 128 };
    }

    ctx.drawImage(video, 0, 0);

    // Sample a 20x20 region at center
    const centerX = (canvasRef.current.width / 2) | 0;
    const centerY = (canvasRef.current.height / 2) | 0;
    const sampleSize = 20;
    const x = Math.max(0, centerX - sampleSize / 2);
    const y = Math.max(0, centerY - sampleSize / 2);

    const imageData = ctx.getImageData(x, y, sampleSize, sampleSize);
    const data = imageData.data;

    let totalBrightness = 0;
    let totalRed = 0;
    let totalGreen = 0;
    let totalBlue = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      totalBrightness += (r + g + b) / 3;
      totalRed += r;
      totalGreen += g;
      totalBlue += b;
    }

    const sampleCount = imageData.data.length / 4;
    return {
      brightness: Math.round(totalBrightness / sampleCount),
      red: Math.round(totalRed / sampleCount),
      green: Math.round(totalGreen / sampleCount),
      blue: Math.round(totalBlue / sampleCount),
    };
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
    stateRef.current = 'complete';
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
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
    }
    
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
    }

    stateRef.current = 'idle';
    bitsRef.current = [];
    fileDecodedRef.current = false;
    decodedFileRef.current = null;
    purpleStreakRef.current = 0;
    setState('idle');
    setBits([]);
    setBitsReceived(0);
    setCountdown(3);
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
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }
      decodedFileRef.current = null;
      purpleStreakRef.current = 0;
      setDebugShowPanel(false);
      setDebugPurpleStreak(0);
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
            <>
              <div className={styles.brightnessIndicator}>
                <div
                  className={styles.brightnessBox}
                  style={{
                    backgroundColor: `rgb(${displayBrightness}, ${displayBrightness}, ${displayBrightness})`,
                  }}
                />
                <span>{displayBrightness}</span>
              </div>
              
              {/* DEBUG PANEL - Real-time RGB and purple detection */}
              {debugShowPanel && (
                <div className={styles.debugPanel}>
                  <div className={styles.debugHeader}>
                    📊 DEBUG: Live RGB Sampling
                    <button
                      onClick={() => setDebugShowPanel(false)}
                      className={styles.debugClose}
                    >
                      ✕
                    </button>
                  </div>
                  <div className={styles.debugContent}>
                    <div className={styles.debugColorSwatch} style={{ backgroundColor: debugColor }} />
                    <div className={styles.debugValues}>
                      {debugRgb}
                      <br />
                      Purple Detected: {debugPurpleDetected ? '✓ YES' : '✗ NO'}
                      <br />
                      Purple Streak: {debugPurpleStreak}/4
                      <br />
                      <span style={{ fontSize: '9px', color: '#00aa00' }}>{debugThresholds}</span>
                    </div>
                  </div>
                </div>
              )}
              {!debugShowPanel && (
                <button
                  onClick={() => setDebugShowPanel(true)}
                  className={styles.debugToggle}
                >
                  [Show Debug]
                </button>
              )}
            </>
        )}

        {/* Status and controls */}
        <div className={styles.statusSection}>
          {state === 'syncing' && countdown >= 0 && (
            <div className={styles.countdown}>
              READY IN: {countdown}
            </div>
          )}
          
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
