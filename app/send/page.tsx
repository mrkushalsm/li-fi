'use client';

import { useState, useRef, useEffect } from 'react';
import { encodeFile, downloadBlob, getFilenameForDownload, generateTerminator } from '@/app/lib/binaryEncoding';
import styles from './send.module.css';

export default function SendPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentBit, setCurrentBit] = useState(0);
  const [totalBits, setTotalBits] = useState(0);
  const [encodedBits, setEncodedBits] = useState<boolean[]>([]);
  const [error, setError] = useState<string>('');

  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const bitIndexRef = useRef(0);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());

  /**
   * Handle file selection
   */
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setError('');
      setProgress(0);
      setCurrentBit(0);
      setTotalBits(0);
    }
  };

  /**
   * Start transmission
   */
  const handleStartTransmit = async () => {
    if (!file) {
      setError('Please select a file first');
      return;
    }

    try {
      setError('');
      setIsTransmitting(true);
      bitIndexRef.current = 0;
      frameCountRef.current = 0;
      lastTimeRef.current = performance.now();

      // Encode the file to bits
      const result = await encodeFile(file);
      
      // Append terminator signal (16 consecutive 1s) to signal end of transmission
      const bitsWithTerminator = [...result.bits, ...generateTerminator()];
      
      setEncodedBits(bitsWithTerminator);
      setTotalBits(bitsWithTerminator.length);
      setProgress(0);
      setCurrentBit(0);

      // Start the RAF transmission loop
      startTransmission(bitsWithTerminator);
    } catch (err) {
      setError(`Encoding failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setIsTransmitting(false);
    }
  };

  /**
   * RAF-based transmission at 30fps
   */
  const startTransmission = (bits: boolean[]) => {
    const frameInterval = 1000 / 30; // ~33.33ms per frame

    const transmit = (currentTime: number) => {
      const elapsed = currentTime - lastTimeRef.current;

      if (elapsed >= frameInterval) {
        // Time for next bit
        if (bitIndexRef.current < bits.length) {
          const bit = bits[bitIndexRef.current];

          // Set screen color based on bit
          if (containerRef.current) {
            containerRef.current.style.backgroundColor = bit ? '#FFFFFF' : '#000000';
          }

          setCurrentBit(bitIndexRef.current);
          setProgress((bitIndexRef.current / bits.length) * 100);

          bitIndexRef.current++;
          lastTimeRef.current = currentTime;
        } else {
          // Transmission complete
          if (containerRef.current) {
            containerRef.current.style.backgroundColor = '#000000';
          }
          setIsTransmitting(false);
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          return;
        }
      }

      rafRef.current = requestAnimationFrame(transmit);
    };

    rafRef.current = requestAnimationFrame(transmit);
  };

  /**
   * Stop transmission
   */
  const handleStop = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    setIsTransmitting(false);
    if (containerRef.current) {
      containerRef.current.style.backgroundColor = '#000000';
    }
  };

  return (
    <div className={styles.page}>
      <div
        ref={containerRef}
        className={styles.transmitterScreen}
        style={{
          backgroundColor: isTransmitting ? '#000000' : '#1a1a1a',
          transition: isTransmitting ? 'none' : 'background-color 0.3s',
        }}
      >
        {!isTransmitting && (
          <div className={styles.content}>
            <h1>Li-Fi Transmitter</h1>
            <p className={styles.subtitle}>Encode a file as light flashes (30Hz)</p>

            <div className={styles.uploadSection}>
              <label htmlFor="fileInput" className={styles.fileLabel}>
                Select File to Transmit:
              </label>
              <input
                id="fileInput"
                type="file"
                onChange={handleFileSelect}
                disabled={isTransmitting}
                className={styles.fileInput}
              />
              {file && (
                <div className={styles.fileInfo}>
                  <span>📦 {file.name}</span>
                  <span>({(file.size / 1024).toFixed(2)} KB)</span>
                </div>
              )}
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <button
              onClick={handleStartTransmit}
              disabled={!file || isTransmitting}
              className={styles.button}
            >
              START TRANSMISSION
            </button>
          </div>
        )}

        {isTransmitting && (
          <div className={styles.transmission}>
            <div className={styles.transmissionInfo}>
              <h2>◀ TRANSMITTING ▶</h2>
              <div className={styles.bitDisplay}>
                Bit {currentBit.toLocaleString()} / {totalBits.toLocaleString()}
              </div>

              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${progress}%` }}
                />
              </div>

              <div className={styles.percentageDisplay}>{progress.toFixed(1)}%</div>

              <button onClick={handleStop} className={styles.stopButton}>
                STOP
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <small>
          💡 Point your device's camera at this screen. Open the receiver on another device
          to capture the transmission.
        </small>
      </div>
    </div>
  );
}
