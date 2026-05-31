import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Invisible resize handles for borderless (decorations: false) windows.
 * Each handle calls Tauri's startResizeDragging with the appropriate direction
 * when the user presses the mouse on a window edge or corner.
 */

type ResizeDir =
  | "North"
  | "South"
  | "East"
  | "West"
  | "NorthEast"
  | "NorthWest"
  | "SouthEast"
  | "SouthWest";

const THICKNESS = 6; // px — edge hit area

export function ResizeHandles() {
  const appWindow = getCurrentWindow();

  const startResize = (dir: ResizeDir) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    appWindow.startResizeDragging(dir);
  };

  const edgeBase = "fixed z-[9999]";

  return (
    <>
      {/* Edges */}
      <div
        className={edgeBase}
        style={{ top: 0, left: THICKNESS, right: THICKNESS, height: THICKNESS, cursor: "ns-resize" }}
        onMouseDown={startResize("North")}
      />
      <div
        className={edgeBase}
        style={{ bottom: 0, left: THICKNESS, right: THICKNESS, height: THICKNESS, cursor: "ns-resize" }}
        onMouseDown={startResize("South")}
      />
      <div
        className={edgeBase}
        style={{ top: THICKNESS, bottom: THICKNESS, left: 0, width: THICKNESS, cursor: "ew-resize" }}
        onMouseDown={startResize("West")}
      />
      <div
        className={edgeBase}
        style={{ top: THICKNESS, bottom: THICKNESS, right: 0, width: THICKNESS, cursor: "ew-resize" }}
        onMouseDown={startResize("East")}
      />

      {/* Corners */}
      <div
        className={edgeBase}
        style={{ top: 0, left: 0, width: THICKNESS, height: THICKNESS, cursor: "nwse-resize" }}
        onMouseDown={startResize("NorthWest")}
      />
      <div
        className={edgeBase}
        style={{ top: 0, right: 0, width: THICKNESS, height: THICKNESS, cursor: "nesw-resize" }}
        onMouseDown={startResize("NorthEast")}
      />
      <div
        className={edgeBase}
        style={{ bottom: 0, left: 0, width: THICKNESS, height: THICKNESS, cursor: "nesw-resize" }}
        onMouseDown={startResize("SouthWest")}
      />
      <div
        className={edgeBase}
        style={{ bottom: 0, right: 0, width: THICKNESS, height: THICKNESS, cursor: "nwse-resize" }}
        onMouseDown={startResize("SouthEast")}
      />
    </>
  );
}
