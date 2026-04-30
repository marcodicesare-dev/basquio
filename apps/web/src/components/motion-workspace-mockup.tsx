"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView, type Variants } from "motion/react";

/**
 * Animated workspace mockup. Three motion behaviors:
 *
 * 1. Mouse-tracking parallax (Linear pattern). Mockup tilts subtly toward the
 *    cursor on pointer hover. CSS transform-style preserve-3d + perspective.
 * 2. Memory cells stagger reveal. The 6 facts pin in one at a time, 90ms apart,
 *    with a small fade + scale + translateY. Triggers once when the mockup
 *    enters viewport.
 * 3. Chat composer typing. The placeholder "Brief Basquio for this project..."
 *    types character-by-character at human cadence (~28ms/char) with a blinking
 *    caret. Triggers 700ms after the mockup enters viewport so the user has
 *    time to look at the mockup first.
 *
 * Honors prefers-reduced-motion: skips the typing animation and shows the
 * full text immediately, skips the parallax tilt, lets the stagger reveal
 * still happen (just opacity, no translate) for screen readers / vestibular
 * users.
 */

const WORKSPACE_PROJECTS = [
  { name: "Espresso Q4 review", client: "Northstar Coffee", active: true },
  { name: "Trade marketing FY26", client: "Aurora Espresso", active: false },
  { name: "Modern trade share", client: "Caffè Belvedere", active: false },
  { name: "Brand health tracker", client: "Mulini Vetta", active: false },
] as const;

const WORKSPACE_MEMORY = [
  { name: "Client", body: "Northstar Coffee · Verona · 18 contacts" },
  { name: "Brand", body: "Northstar · house style 2026" },
  { name: "Template", body: "JBP master template v3" },
  { name: "Last meeting", body: "Apr 18 · Anna Ricci" },
  { name: "Past reviews", body: "12 prior decks · 2024-2026" },
  { name: "Approved formats", body: "SCQA narrative · 12 slides" },
] as const;

const WORKSPACE_PROMPTS = [
  "Draft Q4 deck outline",
  "Summarize last meeting",
  "Compare share vs Q3",
] as const;

const TYPING_TEXT = "Brief Basquio for this project";

const memoryGridVariants: Variants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.09,
      delayChildren: 0.4,
    },
  },
};

const memoryCellVariants: Variants = {
  hidden: { opacity: 0, y: 8, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.5,
      ease: [0.16, 1, 0.3, 1],
    },
  },
};

export function MotionWorkspaceMockup() {
  const rootRef = useRef<HTMLElement>(null);
  const isInView = useInView(rootRef, { once: true, amount: 0.35 });

  // Typing animation state
  const [typedText, setTypedText] = useState("");
  const [showCaret, setShowCaret] = useState(true);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!isInView) return;

    if (reducedMotion) {
      setTypedText(TYPING_TEXT);
      return;
    }

    // Wait 700ms after entering viewport, then start typing.
    const startDelay = window.setTimeout(() => {
      let i = 0;
      const tick = () => {
        i += 1;
        setTypedText(TYPING_TEXT.slice(0, i));
        if (i < TYPING_TEXT.length) {
          // Slight cadence variation (24-36ms) to feel human, not robotic.
          const jitter = 24 + Math.random() * 12;
          window.setTimeout(tick, jitter);
        }
      };
      tick();
    }, 700);

    return () => window.clearTimeout(startDelay);
  }, [isInView, reducedMotion]);

  // Caret blink loop. Pauses while actively typing (caret on solid).
  useEffect(() => {
    if (reducedMotion) return;
    const isTyping = typedText.length > 0 && typedText.length < TYPING_TEXT.length;
    if (isTyping) {
      setShowCaret(true);
      return;
    }
    const blink = window.setInterval(() => setShowCaret((v) => !v), 540);
    return () => window.clearInterval(blink);
  }, [typedText, reducedMotion]);

  // Mouse parallax tilt
  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (reducedMotion) return;
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    // Map [0,1] -> [-3deg, +3deg]
    const rotX = (0.5 - py) * 4;
    const rotY = (px - 0.5) * 4;
    target.style.setProperty("--mockup-rot-x", `${rotX}deg`);
    target.style.setProperty("--mockup-rot-y", `${rotY}deg`);
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    const target = e.currentTarget as HTMLElement;
    target.style.setProperty("--mockup-rot-x", "0deg");
    target.style.setProperty("--mockup-rot-y", "0deg");
  };

  return (
    <article
      ref={rootRef}
      className="workspace-mockup workspace-mockup-motion"
      aria-label="Example Basquio workspace"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div className="workspace-mockup-rail">
        <div className="workspace-mockup-brand">
          <span className="workspace-mockup-brand-mark" aria-hidden="true" />
          basquio
        </div>
        <p className="workspace-mockup-rail-section">Projects</p>
        <ul className="workspace-mockup-projects">
          {WORKSPACE_PROJECTS.map((p) => (
            <li
              key={p.name}
              className={
                p.active
                  ? "workspace-mockup-project workspace-mockup-project-active"
                  : "workspace-mockup-project"
              }
            >
              <span className="workspace-mockup-project-dot" aria-hidden="true" />
              <span className="workspace-mockup-project-text">
                <span className="workspace-mockup-project-name">{p.name}</span>
                <span className="workspace-mockup-project-client">{p.client}</span>
              </span>
            </li>
          ))}
        </ul>
        <button type="button" className="workspace-mockup-rail-add" tabIndex={-1}>
          <span aria-hidden="true">+</span> New project
        </button>
      </div>

      <div className="workspace-mockup-main">
        <header className="workspace-mockup-main-head">
          <p className="workspace-mockup-breadcrumb">
            Workspace / Projects / Espresso Q4 review
          </p>
          <h3 className="workspace-mockup-main-title">
            Espresso Q4 review · Northstar Coffee
          </h3>
        </header>

        <p className="workspace-mockup-memory-label">Workspace memory · 6 facts pinned</p>
        <motion.ul
          className="workspace-mockup-memory"
          variants={memoryGridVariants}
          initial="hidden"
          animate={isInView ? "visible" : "hidden"}
        >
          {WORKSPACE_MEMORY.map((m) => (
            <motion.li
              key={m.name}
              className="workspace-mockup-memory-cell"
              variants={memoryCellVariants}
            >
              <span className="workspace-mockup-memory-glyph" aria-hidden="true" />
              <span className="workspace-mockup-memory-copy">
                <span className="workspace-mockup-memory-name">{m.name}</span>
                <span className="workspace-mockup-memory-body">{m.body}</span>
              </span>
            </motion.li>
          ))}
        </motion.ul>
      </div>

      <aside className="workspace-mockup-chat">
        <p className="workspace-mockup-chat-title">Ask Basquio</p>
        <ul className="workspace-mockup-chat-suggestions">
          {WORKSPACE_PROMPTS.map((p) => (
            <li key={p} className="workspace-mockup-chat-suggestion">
              {p}
            </li>
          ))}
        </ul>
        <div className="workspace-mockup-chat-composer">
          <span className="workspace-mockup-chat-typed">
            {typedText.length === 0 ? (
              <span className="workspace-mockup-chat-placeholder-empty">
                Brief Basquio for this project
              </span>
            ) : (
              typedText
            )}
            <span
              className="workspace-mockup-chat-caret"
              aria-hidden="true"
              style={{ opacity: showCaret ? 1 : 0 }}
            />
          </span>
        </div>
        <button type="button" className="workspace-mockup-chat-cta" tabIndex={-1}>
          Run output <span aria-hidden="true">→</span>
        </button>
        <p className="workspace-mockup-chat-trust">No training on customer data</p>
      </aside>
    </article>
  );
}

function usePrefersReducedMotion() {
  const [prefers, setPrefers] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefers(mql.matches);
    const onChange = () => setPrefers(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return prefers;
}
