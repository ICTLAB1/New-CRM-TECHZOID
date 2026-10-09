import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/shell.css";
import "./documents/preview/preview.css";
import "./styles/motion.css";
import { MotionConfig } from "motion/react";
import { App } from "./app/App";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element in index.html");

createRoot(root).render(
  <StrictMode>
    {/* One timing for every Motion animation in the app, and the user's
        reduced-motion setting respected everywhere (transforms off,
        opacity kept). Matches the CSS scale in styles/motion.css. */}
    <MotionConfig reducedMotion="user" transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}>
      <App />
    </MotionConfig>
  </StrictMode>,
);
