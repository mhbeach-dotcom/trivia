import "./style.css";
import { showHome } from "./ui/screens";

showHome();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
