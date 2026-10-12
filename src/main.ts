import "./style.css";
import { initApp } from "./ui/app";

initApp();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
