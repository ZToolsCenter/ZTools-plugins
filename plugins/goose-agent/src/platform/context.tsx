import { createContext, useContext } from "react";
import type { PlatformAdapter } from "./types";

const PlatformContext = createContext<PlatformAdapter | null>(null);

export function PlatformProvider({
  adapter,
  children,
}: {
  adapter: PlatformAdapter;
  children: React.ReactNode;
}) {
  return (
    <PlatformContext.Provider value={adapter}>
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatform(): PlatformAdapter {
  const adapter = useContext(PlatformContext);
  if (!adapter) {
    throw new Error("usePlatform must be used within a PlatformProvider");
  }
  return adapter;
}
