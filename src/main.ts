import { ensureDefaultRelay } from "./config";
import { dropStaleAppCaches } from "./data/client";
import { BUILD_VERSION } from "./lib/buildInfo";
import { boot } from "./ui/app";
import "./styles.css";

dropStaleAppCaches(BUILD_VERSION);
ensureDefaultRelay();

const root = document.getElementById("app");
if (!root) throw new Error("#app missing");
boot(root);
