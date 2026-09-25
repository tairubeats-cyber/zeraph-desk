import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Inter ships inside the app, so nothing is fetched from a font service when it opens.
import "@fontsource-variable/inter/wght.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
