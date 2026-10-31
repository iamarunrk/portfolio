import { useId, type ReactNode, type SVGProps } from 'react';

/**
 * Inline SVG icon set for the canvas chrome. 24-unit grid, 1.75 stroke,
 * `currentColor` everywhere so icons follow the button's text colour.
 */
export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number };

function Svg({ size = 18, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Two flowing waves: animated, generative shaders. */
export const IconShaders = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 9.5c1.5-2.2 3-2.2 4.5 0s3 2.2 4.5 0 3-2.2 4.5 0 3 2.2 4.5 0" />
    <path d="M3 15c1.5-2.2 3-2.2 4.5 0s3 2.2 4.5 0 3-2.2 4.5 0 3 2.2 4.5 0" opacity="0.55" />
  </Svg>
);

/** A tile filled with a diagonal fade. */
export const IconGradients = (p: IconProps) => {
  const id = useId().replace(/:/g, '');
  return (
    <Svg {...p}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.95" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <rect x="3.75" y="3.75" width="16.5" height="16.5" rx="5" fill={`url(#g${id})`} />
    </Svg>
  );
};

/** A paint drop. */
export const IconColors = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.2c3.6 4.3 6.1 7.6 6.1 10.9a6.1 6.1 0 0 1-12.2 0c0-3.3 2.5-6.6 6.1-10.9z" />
    <path d="M9.3 14.6a2.8 2.8 0 0 0 2.2 2.6" opacity="0.6" />
  </Svg>
);

/** A pane of glass with two reflection streaks. */
export const IconGlass = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.75" y="3.75" width="16.5" height="16.5" rx="5" />
    <path d="M8 12.5l4.5-4.5M8 16.5l8.5-8.5" opacity="0.7" />
  </Svg>
);

/** Sparkles: finishing effects. */
export const IconEffects = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3.5l1.55 4.95L16.5 10l-4.95 1.55L10 16.5l-1.55-4.95L3.5 10l4.95-1.55z" />
    <path d="M17.5 14.5l.75 2.25 2.25.75-2.25.75-.75 2.25-.75-2.25-2.25-.75 2.25-.75z" />
  </Svg>
);

/** A slightly tilted die showing five. */
export const IconDice = (p: IconProps) => (
  <Svg {...p}>
    <g transform="rotate(-10 12 12)">
      <rect x="4" y="4" width="16" height="16" rx="4.2" />
      <g fill="currentColor" stroke="none">
        <circle cx="8.6" cy="8.6" r="1.35" />
        <circle cx="15.4" cy="8.6" r="1.35" />
        <circle cx="12" cy="12" r="1.35" />
        <circle cx="8.6" cy="15.4" r="1.35" />
        <circle cx="15.4" cy="15.4" r="1.35" />
      </g>
    </g>
  </Svg>
);

export const IconReset = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9" />
    <path d="M4.5 4.5V9H9" />
  </Svg>
);

export const IconEye = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.8" />
  </Svg>
);

export const IconEyeOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.6 5.6c.45-.06.92-.1 1.4-.1 6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.4 6.9C3.9 8.6 2.5 12 2.5 12S6 18.5 12 18.5c1.9 0 3.5-.6 4.9-1.5" />
    <path d="M9.9 9.9a2.8 2.8 0 0 0 4.2 3.7" />
    <path d="M3.5 3.5l17 17" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Svg>
);

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5.5v13M5.5 12h13" />
  </Svg>
);

/** Rotate the palette: two arrows chasing each other. */
export const IconShuffle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8.5h12.5l-3-3M20 15.5H7.5l3 3" />
  </Svg>
);

/** Solid four-point star used as a playful accent. */
export const IconSparkle = (p: IconProps) => (
  <Svg {...p} stroke="none">
    <path fill="currentColor" d="M12 2.5c.5 4.6 2.4 7 7 9.5-4.6 2.5-6.5 4.9-7 9.5-.5-4.6-2.4-7-7-9.5 4.6-2.5 6.5-4.9 7-9.5z" />
  </Svg>
);

/** The Zeros mark: a heavy, rounded "0". */
export const ZeroGlyph = ({ size = 20, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...rest}>
    <rect x="5.6" y="2.6" width="12.8" height="18.8" rx="6.4" stroke="currentColor" strokeWidth="3.6" />
    <circle cx="16.9" cy="5.1" r="2.15" fill="#D7FF3A" />
  </svg>
);
