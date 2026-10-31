import { boot } from "./ui/app";
import "./styles.css";

const root = document.getElementById("app");
if (!root) throw new Error("#app missing");
boot(root);
