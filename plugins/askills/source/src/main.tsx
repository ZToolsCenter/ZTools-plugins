import React from "react";
import ReactDOM from "react-dom/client";
import { HostApp } from "./app/HostApp";

// Cards provide their own menu; every other surface suppresses the WebView menu.
document.addEventListener("contextmenu", (event) => event.preventDefault(), {
  capture: true,
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HostApp />
  </React.StrictMode>,
);
