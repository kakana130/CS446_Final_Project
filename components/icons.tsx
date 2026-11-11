/**
 * Simple pictograms in the spirit of road signage: 2px strokes, no fills, currentColor.
 * Always decorative (aria-hidden); every control carries a text label.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 24, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
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

/** A plate with a question mark: "I lost a plate". */
export function LostPlateIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M10 10.2a2 2 0 1 1 2.6 1.9c-.4.1-.6.5-.6.9v.3" />
      <path d="M12 15.6h.01" />
    </Icon>
  );
}

/** A camera: "I found a plate, here's a photo". */
export function CameraIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.5" />
    </Icon>
  );
}

/** Two plates joined: "we match them". */
export function MatchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2" y="4" width="9" height="6" rx="1" />
      <rect x="13" y="14" width="9" height="6" rx="1" />
      <path d="M6.5 10v4a3 3 0 0 0 3 3H13" />
      <path d="m11 15 2 2-2 2" />
    </Icon>
  );
}

/** A phone: "contact each other". */
export function PhoneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <path d="M11 18h2" />
    </Icon>
  );
}

/** A stack of cards: "my posts". */
export function PostsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="7" width="16" height="13" rx="2" />
      <path d="M7 4h10" />
      <path d="M8 12h8M8 16h5" />
    </Icon>
  );
}

/** Magnifier: "search a plate number". */
export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5.5 5.5" />
      <path d="M7.5 10.5h6" />
    </Icon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </Icon>
  );
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14" />
      <path d="m6 13 6 6 6-6" />
    </Icon>
  );
}

/** A tick in a circle: "it matches". */
export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 2.5 2.5L16 9.5" />
    </Icon>
  );
}
