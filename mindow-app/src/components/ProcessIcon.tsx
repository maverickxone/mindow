import { useProcessIcon } from "../hooks/useProcessIcon";

interface ProcessIconProps {
  exePath: string | null;
  size?: number;
}

/** Default icon placeholder (generic app icon) */
function DefaultIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="text-text-muted shrink-0">
      <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1" />
      <rect x="5" y="5" width="6" height="6" rx="1" fill="currentColor" opacity="0.3" />
    </svg>
  );
}

/**
 * Displays a process icon extracted from its exe path.
 * Falls back to a generic placeholder while loading or if unavailable.
 */
export function ProcessIcon({ exePath, size = 16 }: ProcessIconProps) {
  const iconDataUrl = useProcessIcon(exePath);

  if (!iconDataUrl) {
    return <DefaultIcon size={size} />;
  }

  return (
    <img
      src={iconDataUrl}
      alt=""
      width={size}
      height={size}
      className="shrink-0"
      style={{ imageRendering: "auto" }}
    />
  );
}
