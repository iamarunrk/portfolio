import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { useStore, type IslandTab } from '../store';
import type { BaseLayer, BaseMeta, BasePreset, BgConfig, MaterialLayer, MaterialPreset, ParamSpec } from '../bg/types';
import { BASE_META, MATERIAL_META } from '../bg/meta';
import {
  COLOR_PRESETS,
  DEFAULT_BG,
  GRADIENT_PRESETS,
  MATERIAL_PRESETS,
  SHADER_PRESETS,
  defaultBase,
  defaultMaterial,
  randomBg,
} from '../bg/presets';
import { ColorChip, sameColor, toHex6 } from './controls/ColorChip';
import { Slider, formatNumber } from './controls/Slider';
import { Rail, type SwatchItem } from './controls/Swatch';
import { paletteCss, useThumb } from './thumbs';
import { keepKeys } from './keys';
import {
  IconColors,
  IconDice,
  IconEffects,
  IconGlass,
  IconGradients,
  IconPlus,
  IconShaders,
  IconShuffle,
  IconSparkle,
  type IconProps,
} from './icons';
import './ui.css';

/* ------------------------------------------------------------------------ */
/* Tabs and helpers                                                          */
/* ------------------------------------------------------------------------ */

const TABS: { id: IslandTab; label: string; Icon: ComponentType<IconProps> }[] = [
  { id: 'shaders', label: 'Shaders', Icon: IconShaders },
  { id: 'gradients', label: 'Gradients', Icon: IconGradients },
  { id: 'colors', label: 'Colors', Icon: IconColors },
  { id: 'glass', label: 'Glass', Icon: IconGlass },
  { id: 'effects', label: 'Effects', Icon: IconEffects },
];

const PANEL_ID = 'ui-island-panel';
const tabId = (t: IslandTab) => `ui-tab-${t}`;

/** Swatch thumbnails: no grain (noise at 72px) and no vignette, so the look reads. */
const THUMB_FX = { ...DEFAULT_BG.fx, grain: 0, vignette: 0 };
const NO_GLASS: MaterialLayer = defaultMaterial('none');
const baseThumbCfg = (base: BaseLayer): BgConfig => ({ base, material: NO_GLASS, fx: THUMB_FX });

const GRADIENT_KINDS = new Set<string>(GRADIENT_PRESETS.map((p) => p.base.kind));
const SHADER_KINDS = new Set<string>(SHADER_PRESETS.map((p) => p.base.kind));

/** Which tab "owns" a base kind (where its palette and sliders live). */
function tabForKind(kind: BaseLayer['kind']): IslandTab {
  if (kind === 'solid') return 'colors';
  if (GRADIENT_KINDS.has(kind) && !SHADER_KINDS.has(kind)) return 'gradients';
  return 'shaders';
}

const GLASS_PRESETS: MaterialPreset[] = MATERIAL_PRESETS.some((p) => p.material.kind === 'none')
  ? MATERIAL_PRESETS
  : [{ id: 'none', name: 'None', material: NO_GLASS }, ...MATERIAL_PRESETS];

const near = (a: number, b: number) => Math.abs((a ?? 0) - (b ?? 0)) < 1e-3;

/** Same look (speed ignored: Effects can change it without leaving the preset). */
function sameBase(a: BaseLayer, b: BaseLayer): boolean {
  if (a.kind !== b.kind) return false;
  const n = BASE_META[a.kind]?.colorCount ?? 4;
  for (let i = 0; i < n; i++) if (!sameColor(a.colors[i], b.colors[i])) return false;
  return near(a.scale, b.scale) && near(a.angle, b.angle) && near(a.detail, b.detail) && near(a.amount, b.amount);
}

function sameMaterial(a: MaterialLayer, b: MaterialLayer): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'none') return true;
  return (
    near(a.strength, b.strength) &&
    near(a.size, b.size) &&
    near(a.blur, b.blur) &&
    near(a.angle, b.angle) &&
    near(a.highlight, b.highlight) &&
    near(a.aberration, b.aberration) &&
    near(a.tintAmount, b.tintAmount) &&
    sameColor(a.tint, b.tint)
  );
}

/** Exact match first; otherwise the last clicked preset while it's still the same kind. */
function activeBasePreset(presets: BasePreset[], base: BaseLayer, lastId: string | null): BasePreset | undefined {
  const last = lastId ? presets.find((p) => p.id === lastId) : undefined;
  if (last && sameBase(last.base, base)) return last;
  return presets.find((p) => sameBase(p.base, base)) ?? (last && last.base.kind === base.kind ? last : undefined);
}

function activeMaterialPreset(presets: MaterialPreset[], m: MaterialLayer, lastId: string | null): MaterialPreset | undefined {
  const last = lastId ? presets.find((p) => p.id === lastId) : undefined;
  if (last && sameMaterial(last.material, m)) return last;
  return presets.find((p) => sameMaterial(p.material, m)) ?? (last && last.material.kind === m.kind ? last : undefined);
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const times = (v: number) => `${v.toFixed(2)}×`;
const deg = (v: number) => `${Math.round(v)}°`;

function formatFor(spec: ParamSpec): (v: number) => string {
  if (spec.key === 'angle') return deg;
  if (spec.key === 'speed' || spec.key === 'scale') return times;
  if (spec.min === 0 && spec.max === 1) return pct;
  return (v) => formatNumber(v, spec.step);
}

/** Placeholder for a glass swatch: the base palette with a hint of the material. */
function glassFallback(base: BaseLayer, m: MaterialLayer): string {
  const under = paletteCss(base);
  switch (m.kind) {
    case 'none':
      return under;
    case 'fluted':
    case 'ribbed':
      return `repeating-linear-gradient(90deg, rgba(255,255,255,0.16) 0 3px, rgba(0,0,0,0.12) 3px 9px), ${under}`;
    case 'tiles':
    case 'pixelate':
      return `repeating-conic-gradient(rgba(255,255,255,0.12) 0 25%, rgba(0,0,0,0.1) 0 50%) 0 0 / 18px 18px, ${under}`;
    default:
      return `linear-gradient(160deg, rgba(255,255,255,0.24), rgba(255,255,255,0.04) 60%), ${under}`;
  }
}

/* ------------------------------------------------------------------------ */
/* Building blocks                                                           */
/* ------------------------------------------------------------------------ */

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="ui-sec">
      <header className="ui-sec__head">
        <h3 className="ui-sec__title">{title}</h3>
        {aside ? <span className="ui-sec__aside">{aside}</span> : null}
      </header>
      {children}
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="ui-note">
      <IconSparkle size={14} />
      <span>{children}</span>
    </p>
  );
}

function Palette({ base, meta }: { base: BaseLayer; meta: BaseMeta }) {
  const patchBase = useStore((s) => s.patchBase);
  const count = Math.max(1, Math.min(4, meta.colorCount));
  const setColor = (i: number, hex: string) => {
    const colors = [...useStore.getState().bg.base.colors] as BaseLayer['colors'];
    colors[i] = hex;
    patchBase({ colors });
  };
  const rotate = () => {
    const cur = useStore.getState().bg.base.colors;
    const used = cur.slice(0, count);
    patchBase({ colors: [...used.slice(1), used[0], ...cur.slice(count)] as BaseLayer['colors'] });
  };
  return (
    <div className="ui-palette">
      {base.colors.slice(0, count).map((c, i) => (
        <ColorChip key={i} value={c} label={`Palette colour ${i + 1}`} onChange={(hex) => setColor(i, hex)} />
      ))}
      {count > 1 ? (
        <button type="button" className="ui-iconbtn" onClick={rotate} aria-label="Shuffle palette order" data-tip="Shuffle colours">
          <IconShuffle size={16} />
        </button>
      ) : null}
    </div>
  );
}

function BaseSliders({ base, meta, defaults }: { base: BaseLayer; meta: BaseMeta; defaults: BaseLayer }) {
  const patchBase = useStore((s) => s.patchBase);
  return (
    <div className="ui-grid">
      {meta.params.map((p) => (
        <Slider
          key={p.key}
          label={p.label}
          min={p.min}
          max={p.max}
          step={p.step}
          value={base[p.key]}
          defaultValue={defaults[p.key]}
          format={formatFor(p)}
          onChange={(v) => patchBase({ [p.key]: v } as Partial<BaseLayer>)}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Panels                                                                    */
/* ------------------------------------------------------------------------ */

interface PickState {
  lastBase: string | null;
  lastMaterial: string | null;
  setLastBase: (id: string | null) => void;
  setLastMaterial: (id: string | null) => void;
}

function BasePanel({ tab, presets, pick }: { tab: 'shaders' | 'gradients'; presets: BasePreset[]; pick: PickState }) {
  const base = useStore((s) => s.bg.base);
  const setBase = useStore((s) => s.setBase);
  const meta = BASE_META[base.kind];
  const active = activeBasePreset(presets, base, pick.lastBase);
  const items = useMemo<SwatchItem[]>(
    () => presets.map((p) => ({ id: p.id, name: p.name, cfg: baseThumbCfg(p.base), fallback: paletteCss(p.base) })),
    [presets],
  );
  const owns = tabForKind(base.kind) === tab || presets.some((p) => p.base.kind === base.kind);
  const noun = tab === 'shaders' ? 'shader' : 'gradient';

  const onSelect = (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setBase(p.base);
    pick.setLastBase(id);
  };

  return (
    <>
      <Section title={tab === 'shaders' ? 'Shaders' : 'Gradients'} aside={owns && meta ? meta.label : `${presets.length} looks`}>
        <Rail items={items} activeId={active?.id ?? null} onSelect={onSelect} label={tab === 'shaders' ? 'Shader presets' : 'Gradient presets'} />
      </Section>
      {owns && meta ? (
        <>
          <Section title="Palette" aside={`${meta.colorCount} colour${meta.colorCount > 1 ? 's' : ''}`}>
            <Palette base={base} meta={meta} />
          </Section>
          {meta.params.length > 0 ? (
            <Section title="Adjust">
              <BaseSliders base={base} meta={meta} defaults={active?.base ?? defaultBase(base.kind)} />
            </Section>
          ) : null}
        </>
      ) : (
        <Section title="Palette">
          <Note>Pick a {noun} above to remix its colours and motion.</Note>
        </Section>
      )}
    </>
  );
}

function ColorsPanel() {
  const base = useStore((s) => s.bg.base);
  const solid = base.kind === 'solid';
  const current = solid ? toHex6(base.colors[0]) : null;
  const presetIndex = current ? COLOR_PRESETS.findIndex((c) => sameColor(c, current)) : -1;
  const custom = solid && presetIndex < 0;
  const meta = BASE_META.solid;
  const groupRef = useRef<HTMLDivElement>(null);

  const pick = (c: string) => {
    const s = useStore.getState();
    const hex = toHex6(c);
    if (s.bg.base.kind === 'solid') {
      const colors = [...s.bg.base.colors] as BaseLayer['colors'];
      colors[0] = hex;
      s.patchBase({ colors });
    } else {
      s.setBase(defaultBase('solid', [hex, hex, hex, hex]));
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const dots = Array.from(groupRef.current?.querySelectorAll<HTMLButtonElement>('button.ui-dot') ?? []);
    if (!dots.length) return;
    const cur = dots.indexOf(document.activeElement as HTMLButtonElement);
    if (cur < 0) return;
    let next = cur;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (cur + 1) % dots.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (cur - 1 + dots.length) % dots.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = dots.length - 1;
    else return;
    e.preventDefault();
    dots[next].focus();
    pick(COLOR_PRESETS[next]);
  };

  const tabbable = presetIndex >= 0 ? presetIndex : 0;

  return (
    <>
      <Section title="Solid colour" aside={current ? current.toUpperCase() : 'Pick one'}>
        <div className="ui-dots" ref={groupRef} role="radiogroup" aria-label="Solid colours" onKeyDown={onKeyDown}>
          {COLOR_PRESETS.map((c, i) => (
            <button
              key={`${c}-${i}`}
              type="button"
              role="radio"
              aria-checked={i === presetIndex}
              aria-label={toHex6(c).toUpperCase()}
              tabIndex={i === tabbable ? 0 : -1}
              className="ui-dot"
              style={{ '--c': c } as CSSProperties}
              onClick={() => pick(c)}
            >
              <span className="ui-dot__c" />
            </button>
          ))}
          <label className="ui-dot ui-dot--custom" data-checked={custom || undefined} data-tip="Custom colour">
            <span className="ui-dot__c">
              <span className="ui-dot__cur" style={custom && current ? ({ '--cur': current } as CSSProperties) : undefined}>
                {custom ? null : <IconPlus size={12} strokeWidth={2.6} />}
              </span>
            </span>
            <input
              className="ui-dot__input"
              type="color"
              value={current ?? '#ffffff'}
              aria-label="Custom colour"
              onChange={(e) => pick(e.currentTarget.value)}
            />
          </label>
        </div>
      </Section>
      {solid && meta && meta.params.length > 0 ? (
        <Section title="Adjust">
          <BaseSliders base={base} meta={meta} defaults={defaultBase('solid', base.colors)} />
        </Section>
      ) : null}
      {!solid ? (
        <Section title="Tip">
          <Note>A flat colour under frosted or fluted Glass looks expensive.</Note>
        </Section>
      ) : null}
    </>
  );
}

function GlassPanel({ pick }: { pick: PickState }) {
  const base = useStore((s) => s.bg.base);
  const material = useStore((s) => s.bg.material);
  const setMaterial = useStore((s) => s.setMaterial);
  const patchMaterial = useStore((s) => s.patchMaterial);
  const active = activeMaterialPreset(GLASS_PRESETS, material, pick.lastMaterial);
  const meta = MATERIAL_META[material.kind];

  // Swatches render over the CURRENT base, so they re-render (debounced) as it changes.
  const items = useMemo<SwatchItem[]>(
    () =>
      GLASS_PRESETS.map((p) => ({
        id: p.id,
        name: p.name,
        cfg: { base, material: p.material, fx: THUMB_FX },
        fallback: glassFallback(base, p.material),
      })),
    [base],
  );

  const onSelect = (id: string) => {
    const p = GLASS_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setMaterial(p.material);
    pick.setLastMaterial(id);
  };

  const defaults = active?.material ?? defaultMaterial(material.kind);
  const hasControls = material.kind !== 'none' && meta && (meta.params.length > 0 || meta.usesTint);

  return (
    <>
      <Section title="Glass" aside={`over ${BASE_META[base.kind]?.label ?? base.kind}`}>
        <Rail items={items} activeId={active?.id ?? null} onSelect={onSelect} label="Glass presets" debounce={250} />
      </Section>
      {hasControls ? (
        <Section title="Adjust" aside={meta.label}>
          <div className="ui-grid">
            {meta.params.map((p) => (
              <Slider
                key={p.key}
                label={p.label}
                min={p.min}
                max={p.max}
                step={p.step}
                value={material[p.key]}
                defaultValue={defaults[p.key]}
                format={formatFor(p)}
                onChange={(v) => patchMaterial({ [p.key]: v } as Partial<MaterialLayer>)}
              />
            ))}
            {meta.usesTint ? (
              <ColorChip caption="Tint" value={material.tint} label="Glass tint" onChange={(hex) => patchMaterial({ tint: hex })} />
            ) : null}
          </div>
        </Section>
      ) : (
        <Section title="Adjust">
          <Note>Layer a glass over the background, then fine-tune it here.</Note>
        </Section>
      )}
    </>
  );
}

function EffectsPanel() {
  const fx = useStore((s) => s.bg.fx);
  const base = useStore((s) => s.bg.base);
  const patchFx = useStore((s) => s.patchFx);
  const patchBase = useStore((s) => s.patchBase);
  const meta = BASE_META[base.kind];
  const speedSpec = meta?.params.find((p) => p.key === 'speed');
  const animated = meta?.animated ?? false;
  return (
    <Section title="Effects" aside="finishing touches">
      <div className="ui-grid">
        <Slider label="Grain" value={fx.grain} min={0} max={1} step={0.01} format={pct} defaultValue={DEFAULT_BG.fx.grain} onChange={(v) => patchFx({ grain: v })} />
        <Slider
          label="Vignette"
          value={fx.vignette}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          defaultValue={DEFAULT_BG.fx.vignette}
          onChange={(v) => patchFx({ vignette: v })}
        />
        <Slider
          label="Speed"
          value={base.speed}
          min={speedSpec?.min ?? 0}
          max={speedSpec?.max ?? 2}
          step={speedSpec?.step ?? 0.01}
          format={times}
          defaultValue={defaultBase(base.kind).speed}
          disabled={!animated}
          note={animated ? undefined : 'static'}
          onChange={(v) => patchBase({ speed: v })}
        />
      </div>
    </Section>
  );
}

function PanelBody({ tab, pick }: { tab: IslandTab; pick: PickState }) {
  switch (tab) {
    case 'shaders':
      return <BasePanel tab="shaders" presets={SHADER_PRESETS} pick={pick} />;
    case 'gradients':
      return <BasePanel tab="gradients" presets={GRADIENT_PRESETS} pick={pick} />;
    case 'colors':
      return <ColorsPanel />;
    case 'glass':
      return <GlassPanel pick={pick} />;
    case 'effects':
      return <EffectsPanel />;
  }
}

/* ------------------------------------------------------------------------ */
/* Collapsed row pieces                                                      */
/* ------------------------------------------------------------------------ */

function CurrentSwatch({ onOpen }: { onOpen: (tab: IslandTab) => void }) {
  const bg = useStore((s) => s.bg);
  const cfg = useMemo<BgConfig>(() => ({ ...bg, fx: { ...bg.fx, grain: 0 } }), [bg]);
  const url = useThumb(cfg, 56, 56, { debounce: 140, priority: 3 });
  const label = BASE_META[bg.base.kind]?.label ?? bg.base.kind;
  const glass = bg.material.kind !== 'none' ? MATERIAL_META[bg.material.kind]?.label : null;
  const name = glass ? `${label} + ${glass}` : label;
  return (
    <button
      type="button"
      className="ui-mini"
      onClick={() => onOpen(tabForKind(bg.base.kind))}
      aria-label={`Current background: ${name}. Edit it`}
      data-tip={name}
    >
      <span className="ui-mini__thumb" style={{ background: paletteCss(bg.base) }}>
        {url ? <img src={url} alt="" draggable={false} decoding="async" /> : null}
      </span>
    </button>
  );
}

function DiceButton() {
  const [rolls, setRolls] = useState(0);
  const roll = () => {
    useStore.getState().setBg(randomBg());
    setRolls((r) => r + 1);
  };
  return (
    <button type="button" className="ui-dice" onClick={roll} aria-label="Surprise me: random background" data-tip="Surprise me">
      <IconDice key={rolls} size={20} className={rolls ? 'ui-roll' : undefined} />
    </button>
  );
}

/* ------------------------------------------------------------------------ */
/* Island                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Bottom-centre "island": a live mini-swatch, five tabs and a dice. A tab opens
 * its panel, which grows upward inside the same glass container. The active
 * tab again, Esc, or a click that starts outside the island collapses it.
 */
export function Island() {
  const tab = useStore((s) => s.islandTab);
  const setTab = useStore((s) => s.setIslandTab);
  const hidden = useStore((s) => s.uiHidden);

  const rootRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<IslandTab, HTMLButtonElement | null>>>({});

  // Keep the last panel rendered while the island collapses.
  const [shown, setShown] = useState<IslandTab | null>(tab);
  const content = tab ?? shown;
  const [innerH, setInnerH] = useState(0);
  const [roving, setRoving] = useState<IslandTab>(tab ?? 'shaders');

  const [lastBase, setLastBase] = useState<string | null>(null);
  const [lastMaterial, setLastMaterial] = useState<string | null>(null);
  const pick: PickState = { lastBase, lastMaterial, setLastBase, setLastMaterial };

  useEffect(() => {
    if (tab) {
      setShown(tab);
      setRoving(tab);
      return;
    }
    const t = setTimeout(() => setShown(null), 380);
    return () => clearTimeout(t);
  }, [tab]);

  // A whole new background (dice, reset) invalidates "last clicked" memory.
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        const b = s.bg;
        const p = prev.bg;
        if (b !== p && b.base !== p.base && b.material !== p.material && b.fx !== p.fx) {
          setLastBase(null);
          setLastMaterial(null);
        }
      }),
    [],
  );

  // Measure the panel content so the height can animate (incl. tab-to-tab).
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => setInnerH(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Hiding the chrome collapses the island.
  useEffect(() => {
    if (hidden && useStore.getState().islandTab) setTab(null);
  }, [hidden, setTab]);

  // Esc / click outside collapse. Only listens while open, never blocks the event.
  useEffect(() => {
    if (!tab) return;
    const onDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && root.contains(e.target)) return;
      setTab(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const root = rootRef.current;
      const inside = !!root && root.contains(document.activeElement);
      // Esc closes the innermost thing first; the canvas gets the next one.
      e.stopPropagation();
      setTab(null);
      if (inside) tabRefs.current[tab]?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [tab, setTab]);

  const toggle = (id: IslandTab) => setTab(tab === id ? null : id);

  const onTabsKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const ids = TABS.map((t) => t.id);
    const cur = Math.max(0, ids.findIndex((id) => tabRefs.current[id] === document.activeElement));
    let next = cur;
    if (e.key === 'ArrowRight') next = (cur + 1) % ids.length;
    else if (e.key === 'ArrowLeft') next = (cur - 1 + ids.length) % ids.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ids.length - 1;
    else if (e.key === 'ArrowUp' && !tab) {
      // ArrowUp opens the focused tab's panel, like a menu button
      e.preventDefault();
      setTab(ids[cur]);
      return;
    } else return;
    e.preventDefault();
    const id = ids[next];
    setRoving(id);
    tabRefs.current[id]?.focus();
    if (tab) setTab(id); // while open, follow focus (automatic activation)
  };

  return (
    <div
      ref={rootRef}
      className="ui ui-glass ui-island ui-hideable"
      data-open={tab ? '' : undefined}
      data-hidden={hidden || undefined}
      inert={hidden}
      onKeyDown={keepKeys}
    >
      <div className="ui-panel" style={{ height: tab ? innerH : 0 }} inert={!tab} aria-hidden={tab ? undefined : true}>
        <div
          ref={innerRef}
          className="ui-panel__inner"
          id={PANEL_ID}
          role="tabpanel"
          aria-labelledby={content ? tabId(content) : undefined}
        >
          {content ? (
            <div className="ui-pbody" key={content}>
              <PanelBody tab={content} pick={pick} />
            </div>
          ) : null}
        </div>
      </div>

      <div className="ui-bar">
        <CurrentSwatch onOpen={(t) => setTab(t)} />
        <span className="ui-sep" aria-hidden="true" />
        <div className="ui-tabs" role="tablist" aria-label="Remix the background" onKeyDown={onTabsKey}>
          {TABS.map(({ id, label, Icon }) => {
            const selected = tab === id;
            return (
              <button
                key={id}
                ref={(el) => {
                  tabRefs.current[id] = el;
                }}
                type="button"
                role="tab"
                id={tabId(id)}
                aria-selected={selected}
                aria-controls={PANEL_ID}
                tabIndex={(tab ?? roving) === id ? 0 : -1}
                className="ui-tab"
                onClick={() => toggle(id)}
                onFocus={() => setRoving(id)}
              >
                <Icon className="ui-tab__icon" size={17} />
                <span className="ui-tab__label">{label}</span>
              </button>
            );
          })}
        </div>
        <span className="ui-sep" aria-hidden="true" />
        <DiceButton />
      </div>
    </div>
  );
}
