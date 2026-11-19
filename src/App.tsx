import { useEffect, useRef } from 'react';
import { createBoard } from './board/board';
import { TitleFrame } from './hero/TitleFrame';
import { GizmoOverlay } from './overlay/GizmoOverlay';
import { Stage } from './scene/Stage';
import { useStore } from './store';
import { Hint } from './ui/Hint';
import { Island } from './ui/Island';
import { ScrollCue } from './ui/ScrollCue';
import { TopBar } from './ui/TopBar';

/**
 * The page is a design board. The homepage (canvas, headline, chrome) is one frame on it:
 * scrolling pulls the camera back to the whole board, clicking the frame flies back in.
 */
export default function App() {
  const app = useRef<HTMLElement>(null);
  const home = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const over = useRef<HTMLDivElement>(null);
  const casePage = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!app.current || !home.current || !stage.current || !over.current || !casePage.current || !hud.current) return;
    const board = createBoard({
      app: app.current,
      home: home.current,
      stage: stage.current,
      over: over.current,
      casePage: casePage.current,
      hud: hud.current,
      onView: (v) => useStore.getState().setView(v),
      onGlActive: (v) => useStore.getState().setGlActive(v),
      hasSelection: () => useStore.getState().selected != null,
    });
    return () => board.destroy();
  }, []);

  return (
    <main className="app" ref={app}>
      <div className="bd-stage" ref={stage} aria-label="Work board" />
      <div className="home" ref={home}>
        <Stage />
        <TitleFrame />
        <GizmoOverlay />
        <TopBar />
        <Island />
        <Hint />
        <ScrollCue />
      </div>
      <div className="bd-over" ref={over} />
      <div className="casepage" ref={casePage} />
      <div className="bd-hudroot" ref={hud} />
    </main>
  );
}
