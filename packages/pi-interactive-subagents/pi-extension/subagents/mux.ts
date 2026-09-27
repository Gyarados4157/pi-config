/**
 * Herdr-only surface. Kept as mux.ts so index.ts import paths stay stable.
 */
export {
  isHerdrAvailable as isMuxAvailable,
  herdrSetupHint as muxSetupHint,
  shellEscape,
  createSurface,
  createSurfaceSplit,
  createSurfaceSplitAuto,
  sendCommand,
  sendLongCommand,
  readScreen,
  readScreenAsync,
  closeSurface,
  pollForExit,
  unwrapPaneRead,
  __pollForExitTest__,
} from "./herdr.ts";
export type { SurfaceOwnership } from "./herdr.ts";
