import { clipboardWindowRole } from "./clipboard-window-role";
import { inspectHostCompatibility } from "./host-compatibility";
import { createSupportedPreloadServices } from "./ztools-preload-services";
import { createZToolsHistoryCoordinator } from "./ztools-history-coordinator";
import { createZToolsPreloadBridge } from "./ztools-preload-bridge";
import type {
  PasteboardProBridge,
  PasteboardProCapabilities,
  PreloadEnvironment,
  ZToolsHost,
} from "./ztools-preload-contracts";

const environment = require("electron") as PreloadEnvironment;
const host = (window as Window & { ztools?: ZToolsHost }).ztools;

if (host === undefined) {
  throw new Error("PasteboardPro must run inside ZTools");
}

const hostCompatibility = inspectHostCompatibility(host);
const platform = process.platform;
const platformCapabilities: PasteboardProCapabilities = {
  platform,
  supportsGlobalPasteQueue: platform === "darwin",
  supportsQuickLook: platform === "darwin" || platform === "win32" || platform === "linux",
  supportsSystemOcr: true,
  supportsImageRotation: platform === "darwin" || platform === "win32" || platform === "linux",
  supportsNativeFileDrag: hostCompatibility.supportsNativeFileDrag,
  supportsScreenCapture: hostCompatibility.supportsScreenCapture,
};

if (!hostCompatibility.supported) {
  const compatibilityBridge = {
    getHostCompatibility: () => hostCompatibility,
    getPlatformCapabilities: () => platformCapabilities,
  } as PasteboardProBridge;
  (window as Window & { pasteboardPro?: PasteboardProBridge }).pasteboardPro = compatibilityBridge;
} else {
  const role = clipboardWindowRole(new URLSearchParams(window.location.search));
  const services = createSupportedPreloadServices({
    ztools: host,
    environment,
    window,
    role,
    platform,
  });
  const coordinator = createZToolsHistoryCoordinator({
    ztools: host,
    clipboard: environment.clipboard,
    ipcRenderer: environment.ipcRenderer,
    window,
    role,
    services,
  });
  coordinator.install();
  const bridge = createZToolsPreloadBridge({
    ztools: host,
    clipboard: environment.clipboard,
    nativeImage: environment.nativeImage,
    platformCapabilities,
    hostCompatibility,
    services,
    coordinator,
  });
  (window as Window & { pasteboardPro?: PasteboardProBridge }).pasteboardPro = bridge;
}
