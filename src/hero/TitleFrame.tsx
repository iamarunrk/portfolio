import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ensureFonts } from '../fonts';
import { useFrameStore } from '../scene/registry';
import { useStore } from '../store';
import { titleLive } from './titleLive';
import './hero.css';

/**
 * The headline, treated as a frame on the canvas: visitors can select it, drag
 * it and scale it from its corners (the canvas controller handles pointers; the
 * text itself is pointer-transparent so toys behind it stay grabbable).
 */
export function TitleFrame() {
  const ink = useStore((s) => s.ink);
  const title = useStore((s) => s.title);
  const frame = useFrameStore((s) => s.frame);
  const elRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [fontsReady, setFontsReady] = useState(false);

  // Reveal once the display faces are in, so the headline never flashes in a fallback font.
  useEffect(() => {
    let alive = true;
    ensureFonts().then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  useLayoutEffect(() => {
    titleLive.el = elRef.current;
    titleLive.box = boxRef.current;
    return () => {
      titleLive.el = null;
      titleLive.box = null;
    };
  }, []);

  useLayoutEffect(() => {
    titleLive.sync(title, frame);
  }, [title, frame]);

  return (
    <div ref={elRef} className={`hero${fontsReady ? ' is-ready' : ''}`} data-ink={ink}>
      <div ref={boxRef} className="hero-box">
        <h1 className="hero-title">
          <span className="hero-l1">Once upon a time</span>
          <span className="hero-l2">
            <span className="hero-iwas">i was a</span>{' '}
            <span className="hero-pd">
              <span>product designer</span>
            </span>
          </span>
        </h1>
        <p className="hero-sticker">
          <span className="hero-sticker-now">now</span>
          <span>founder of</span>
          <b>Zeros</b>
        </p>
      </div>
    </div>
  );
}
