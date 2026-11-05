import { useEffect, useLayoutEffect, useState } from "react";
import { pluginHost, type HostPage } from "../lib/host";
import App from "./App";
import { I18nProvider } from "./i18n";
import "./ztools-theme.css";

/** Each plugin visit gets a fresh UI: preview/selection tokens belong to a helper session. */
export function HostApp() {
  const host = pluginHost();
  const [visit, setVisit] = useState<{
    page: HostPage;
    sequence: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (!host) return;
    document.documentElement.dataset.host = "ztools";
    return () => {
      delete document.documentElement.dataset.host;
      delete document.documentElement.dataset.hostTheme;
    };
  }, [host]);
  useEffect(() => {
    if (!host) return;
    let sequence = 0;
    const stopEnter = host.onEnter((page) =>
      setVisit({ page, sequence: ++sequence }),
    );
    const stopOut = host.onOut(() => setVisit(null));
    return () => {
      stopEnter();
      stopOut();
    };
  }, [host]);

  if (host && !visit) return null;
  return (
    <I18nProvider key={visit?.sequence ?? "desktop"}>
      <App initialPage={visit?.page} />
    </I18nProvider>
  );
}
