type LogoProps = {
  wordmark?: boolean;
  size?: number;
};

export default function Logo({ wordmark = true, size = 20 }: LogoProps) {
  return (
    <span className="sb-logo">
      <LogoMark size={size} />
      {wordmark ? <span className="sb-wordmark">ShipBridge</span> : null}
    </span>
  );
}

export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#003087" d="M2 11.2h11v11H2z" />
      <path fill="#003087" d="M2 8h13.4L21.2 11.2 15.4 14.4H2z" />
    </svg>
  );
}
