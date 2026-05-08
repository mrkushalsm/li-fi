'use client';

import Link from 'next/link';
import styles from './home.module.css';

export default function Home() {
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>Li-Fi</h1>
        <p className={styles.subtitle}>Light Fidelity — Optical Wireless File Transfer</p>

        <div className={styles.description}>
          <p>
            Transfer files using visible light. The sender encodes a file as binary light flashes 
            on screen (white = 1, black = 0) at 30Hz. The receiver uses a webcam to read those 
            flashes and reconstruct the file.
          </p>
          <p>💡 Point your device's camera at the sender's screen to receive files instantly.</p>
        </div>

        <div className={styles.buttonGroup}>
          <Link href="/send" className={styles.button}>
            ▶ SENDER
          </Link>
          <Link href="/receive" className={styles.button}>
            ◀ RECEIVER
          </Link>
        </div>

        <div className={styles.features}>
          <div className={styles.feature}>
            <span className={styles.icon}>💾</span>
            <span>Any File Type</span>
          </div>
          <div className={styles.feature}>
            <span className={styles.icon}>📱</span>
            <span>No WiFi Needed</span>
          </div>
          <div className={styles.feature}>
            <span className={styles.icon}>👁️</span>
            <span>Blink Detector</span>
          </div>
          <div className={styles.feature}>
            <span className={styles.icon}>⚡</span>
            <span>30Hz Transfer</span>
          </div>
        </div>

        <div className={styles.footer}>
          <small>🔬 Experimental optical data transmission — for demo & educational purposes</small>
        </div>
      </div>
    </div>
  );
}


