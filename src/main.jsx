import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./styles.css";
import { isNativeAndroidApp } from "./utils/nativeCamera";

let refreshing = false;

const nativeAndroid = isNativeAndroidApp();

if (!nativeAndroid && typeof window !== "undefined" && "serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

const updateSW = !nativeAndroid ? registerSW({
  immediate: true,
  onRegisteredSW(_, registration) {
    if (!registration || typeof window === "undefined") return;

    const checkForUpdates = () => registration.update().catch(() => {});
    window.addEventListener("focus", checkForUpdates);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        checkForUpdates();
      }
    });
  },
  onNeedRefresh() {
    updateSW(true);
  }
}) : () => {};

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
