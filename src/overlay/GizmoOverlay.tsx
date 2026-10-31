import { useEffect, useRef } from 'react';
import { AXES, AXIS_COLOR, registerOverlay, type Axis, type GizmoFrame } from '../scene/gizmo';
import { registry } from '../scene/registry';
import { useStore } from '../store';
import './overlay.css';

const CORNERS = [0, 1, 2, 3] as const;

/**
 * Screen-space gizmo drawn as SVG over the WebGL canvas: three rotation rings
 * (front solid, back dashed), the swept-angle wedge, a scale knob, the
 * selection pill, and a Figma-style frame box for the hero title.
 * Purely visual: the canvas controller does all hit-testing.
 */
export function GizmoOverlay() {
  const selected = useStore((s) => s.selected);
  const resetObject = useStore((s) => s.resetObject);
  const setTitle = useStore((s) => s.setTitle);
  const uiHidden = useStore((s) => s.uiHidden);

  const objG = useRef<SVGGElement>(null);
  const silhouette = useRef<SVGCircleElement>(null);
  const wedge = useRef<SVGPathElement>(null);
  const backs = useRef<Record<Axis, SVGPathElement | null>>({ x: null, y: null, z: null });
  const fronts = useRef<Record<Axis, SVGPathElement | null>>({ x: null, y: null, z: null });
  const centerDot = useRef<SVGCircleElement>(null);
  const knob = useRef<SVGGElement>(null);
  const titleG = useRef<SVGGElement>(null);
  const titleRect = useRef<SVGRectElement>(null);
  const corners = useRef<(SVGRectElement | null)[]>([]);
  const selPill = useRef<HTMLDivElement>(null);
  const frameTag = useRef<HTMLDivElement>(null);
  const frameSize = useRef<HTMLDivElement>(null);
  const valuePill = useRef<HTMLDivElement>(null);
  const last = useRef({ obj: '', title: '', pill: '' });

  useEffect(() => {
    const setStyle = (el: HTMLElement | SVGElement | null, prop: 'display' | 'opacity' | 'pointerEvents', v: string) => {
      if (el && el.style[prop] !== v) el.style[prop] = v;
    };
    registerOverlay((f: GizmoFrame) => {
      const o = f.object;
      setStyle(objG.current, 'display', o ? '' : 'none');
      setStyle(selPill.current, 'opacity', o && !o.moving ? '1' : '0');
      setStyle(selPill.current, 'pointerEvents', o && !o.moving ? 'auto' : 'none');
      if (!o && !f.title && !f.pill && last.current.obj === 'none') return;
      last.current.obj = o || f.title || f.pill ? 'some' : 'none';
      if (o) {
        silhouette.current?.setAttribute('cx', o.cx.toFixed(1));
        silhouette.current?.setAttribute('cy', o.cy.toFixed(1));
        silhouette.current?.setAttribute('r', Math.max(4, o.r).toFixed(1));
        for (const axis of AXES) {
          const b = backs.current[axis];
          const fr = fronts.current[axis];
          if (b) b.setAttribute('d', o.rings[axis].back || 'M0 0');
          if (fr) fr.setAttribute('d', o.rings[axis].front || 'M0 0');
          const active = o.activeAxis === axis;
          const hover = o.hoverAxis === axis;
          const dim = o.activeAxis !== null && !active;
          const cls = `${active ? ' is-active' : ''}${hover ? ' is-hover' : ''}${dim ? ' is-dim' : ''}`;
          if (fr) fr.setAttribute('class', `ring-front ring-${axis}${cls}`);
          if (b) b.setAttribute('class', `ring-back ring-${axis}${cls}`);
        }
        if (wedge.current) {
          if (o.wedge) {
            wedge.current.setAttribute('d', o.wedge.d);
            wedge.current.style.fill = AXIS_COLOR[o.wedge.axis];
            wedge.current.style.stroke = AXIS_COLOR[o.wedge.axis];
            wedge.current.style.display = '';
          } else wedge.current.style.display = 'none';
        }
        centerDot.current?.setAttribute('cx', o.cx.toFixed(1));
        centerDot.current?.setAttribute('cy', o.cy.toFixed(1));
        if (knob.current) {
          knob.current.setAttribute('transform', `translate(${o.knob[0].toFixed(1)} ${o.knob[1].toFixed(1)})`);
          knob.current.setAttribute('class', `knob${o.knobHover ? ' is-hover' : ''}${o.knobActive ? ' is-active' : ''}`);
        }
        const pill = selPill.current;
        if (pill) {
          // Above the rings, or below them when that would collide with the top edge; clamp sideways.
          const pw = pill.offsetWidth || 200;
          const ph = pill.offsetHeight || 36;
          const vw = window.innerWidth;
          const above = o.cy - o.r - 22 - ph > 64;
          const y = above ? o.cy - o.r - 22 - ph : o.cy + o.r + 26;
          const x = Math.min(Math.max(o.cx - pw / 2, 10), vw - pw - 10);
          pill.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        }
      }

      const t = f.title;
      setStyle(titleG.current, 'display', t ? '' : 'none');
      const showTags = !!t && t.selected;
      setStyle(frameTag.current, 'opacity', t ? '1' : '0');
      setStyle(frameTag.current, 'pointerEvents', showTags ? 'auto' : 'none');
      setStyle(frameSize.current, 'opacity', showTags ? '1' : '0');
      if (t) {
        titleRect.current?.setAttribute('x', t.x.toFixed(1));
        titleRect.current?.setAttribute('y', t.y.toFixed(1));
        titleRect.current?.setAttribute('width', Math.max(0, t.w).toFixed(1));
        titleRect.current?.setAttribute('height', Math.max(0, t.h).toFixed(1));
        titleRect.current?.setAttribute('class', `frame-rect${t.selected ? ' is-selected' : ''}`);
        const pts: [number, number][] = [
          [t.x, t.y],
          [t.x + t.w, t.y],
          [t.x + t.w, t.y + t.h],
          [t.x, t.y + t.h],
        ];
        corners.current.forEach((c, i) => {
          if (!c) return;
          c.setAttribute('x', (pts[i][0] - 4.5).toFixed(1));
          c.setAttribute('y', (pts[i][1] - 4.5).toFixed(1));
          c.style.display = t.selected ? '' : 'none';
        });
        if (frameTag.current) frameTag.current.style.transform = `translate3d(${t.x.toFixed(1)}px, ${(t.y - 6).toFixed(1)}px, 0) translateY(-100%)`;
        if (frameSize.current) {
          frameSize.current.style.transform = `translate3d(${(t.x + t.w / 2).toFixed(1)}px, ${(t.y + t.h + 8).toFixed(1)}px, 0) translateX(-50%)`;
          const label = `${Math.round(t.w)} × ${Math.round(t.h)}`;
          if (last.current.title !== label) {
            frameSize.current.textContent = label;
            last.current.title = label;
          }
        }
      }

      const p = f.pill;
      if (valuePill.current) {
        setStyle(valuePill.current, 'opacity', p ? '1' : '0');
        if (p) {
          valuePill.current.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
          valuePill.current.style.background = p.color;
          if (last.current.pill !== p.text) {
            valuePill.current.textContent = p.text;
            last.current.pill = p.text;
          }
        }
      }
    });
    return () => registerOverlay(null);
  }, []);

  const obj = selected && selected !== 'title' ? registry.get(selected) : undefined;

  return (
    <div className={`overlay${uiHidden ? ' is-hidden' : ''}`} aria-hidden={false}>
      <svg className="overlay-svg" width="100%" height="100%">
        <g ref={objG} style={{ display: 'none' }}>
          <circle ref={silhouette} className="silhouette" />
          <path ref={wedge} className="wedge" />
          {AXES.map((a) => (
            <path key={`b${a}`} ref={(el) => {
                backs.current[a] = el;
              }} className={`ring-back ring-${a}`} />
          ))}
          {AXES.map((a) => (
            <path key={`f${a}`} ref={(el) => {
                fronts.current[a] = el;
              }} className={`ring-front ring-${a}`} />
          ))}
          <circle ref={centerDot} className="center-dot" r={4.5} />
          <g ref={knob} className="knob">
            <circle r={11} className="knob-hit" />
            <circle r={8.5} className="knob-body" />
            <path d="M-3.2 3.2 L3.2 -3.2 M0.2 -3.4 H3.4 V-0.2 M-3.4 0.2 V3.4 H-0.2" className="knob-icon" />
          </g>
        </g>
        <g ref={titleG} style={{ display: 'none' }}>
          <rect ref={titleRect} className="frame-rect" rx={2} />
          {CORNERS.map((i) => (
            <rect key={i} ref={(el) => {
                corners.current[i] = el;
              }} className="frame-corner" width={9} height={9} rx={1.5} />
          ))}
        </g>
      </svg>

      <div ref={selPill} className="sel-pill" style={{ opacity: 0 }}>
        {obj && (
          <span key={obj.id} className="sel-touch-hint" aria-hidden>
            pinch to scale · twist to rotate · drag a ring to tumble
          </span>
        )}
        <span className="sel-dot" aria-hidden />
        <span className="sel-name">{obj?.name ?? ''}</span>
        <span className="sel-tag">{obj?.tagline ?? ''}</span>
        <span className="sel-sep" aria-hidden />
        <button
          className="sel-btn"
          title="Spin it"
          aria-label="Spin it"
          onClick={() => {
            if (obj) obj.spin += Math.PI * 2;
          }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className="sel-btn"
          title="Reset position, rotation & size"
          aria-label="Reset object"
          onClick={() => {
            if (obj) resetObject(obj.id);
          }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.5v3h3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Reset</span>
        </button>
      </div>

      <div ref={frameTag} className="frame-tag" style={{ opacity: 0 }}>
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
          <path d="M3 1v10M9 1v10M1 3h10M1 9h10" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        Hero title
        {selected === 'title' && (
          <button className="frame-reset" onClick={() => setTitle(null)} aria-label="Reset title position">
            Reset
          </button>
        )}
      </div>
      <div ref={frameSize} className="frame-size" style={{ opacity: 0 }} />
      <div ref={valuePill} className="value-pill" style={{ opacity: 0 }} />
    </div>
  );
}
