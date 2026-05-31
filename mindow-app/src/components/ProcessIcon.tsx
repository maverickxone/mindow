import { useProcessIcon } from "../hooks/useProcessIcon";

interface ProcessIconProps {
  exePath: string | null;
  size?: number;
  /** Process name used to generate a distinctive fallback color */
  processName?: string;
}

/**
 * Default icon placeholder — generates a unique color from the process name
 * so different system processes don't all look the same.
 */
function DefaultIcon({ size, processName }: { size: number; processName?: string }) {
  // Generate a deterministic hue from the process name for variety
  const hue = processName
    ? [...processName].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 360
    : 220;

  const bgColor = `hsl(${hue}, 30%, 75%)`;
  const fgColor = `hsl(${hue}, 40%, 35%)`;

  // First letter of process name (uppercase) as the icon content
  const letter = processName ? processName.charAt(0).toUpperCase() : "?";

  return (
    <div
      className="shrink-0 flex items-center justify-center rounded"
      style={{
        width: size,
        height: size,
        backgroundColor: bgColor,
        color: fgColor,
        fontSize: size * 0.55,
        fontWeight: 600,
        lineHeight: 1,
      }}
      aria-hidden="true"
    >
      {letter}
    </div>
  );
}

/**
 * Displays a process icon extracted from its exe path.
 * Falls back to a colorful letter-based placeholder while loading or if unavailable.
 * Icons are fetched at 32×32 from the backend and rendered smoothly at display size.
 */
export function ProcessIcon({ exePath, size = 16, processName }: ProcessIconProps) {
  const iconDataUrl = useProcessIcon(exePath);

  if (!iconDataUrl) {
    return <DefaultIcon size={size} processName={processName} />;
  }

  return (
    <img
      src={iconDataUrl}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-sm"
      style={{
        imageRendering: "auto",
        // Smooth downscaling from 32×32 source to display size
        objectFit: "contain",
      }}
      draggable={false}
    />
  );
}
