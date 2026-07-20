import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import { initNativeStatusBar } from "./lib/native-status-bar";
import { prefetchMapboxToken } from "./hooks/useMapboxToken";

void initNativeStatusBar();
// Warm the Mapbox token cache during app boot so the first map paints instantly
void prefetchMapboxToken();

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>
);
