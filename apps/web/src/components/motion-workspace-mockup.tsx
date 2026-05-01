"use client";

import { useEffect, useRef, useState } from "react";
import { motion, type Variants } from "motion/react";

/**
 * Scripted demo of the Basquio workspace, in the style of Lovable / v0 / Cursor
 * homepage hero animations.
 *
 * Sequence (triggers once when 15% of the mockup enters viewport):
 *
 *   t = 0      Mockup is visible, cursor is hidden, composer is empty.
 *   t = 0.6s   Cursor fades in at center, glides to the "Compare share vs Q3"
 *              suggestion chip (top-right of chat panel).
 *   t = 1.5s   Cursor clicks the chip. The chip flashes ultramarine.
 *   t = 1.8s   The clicked text "Compare share vs Q3" begins typing into the
 *              composer at human cadence (24-36ms/char with jitter).
 *   t = 3.4s   Cursor glides down to the "Run output" button.
 *   t = 4.2s   Cursor clicks the button. Button compresses + shows a spinner.
 *   t = 5.4s   Spinner replaced by green check + "Output ready". Three
 *              artifact pills (deck.pptx, narrative_report.md, data_tables.xlsx)
 *              fade up below the button.
 *   t = 6.5s   Loop cooldown. After 7s of stillness, the sequence restarts.
 *
 * Memory cells (the 6 facts) stagger in once on viewport enter (see
 * memory variants below). The whole shell tilts subtly toward the cursor on
 * native mouse hover (parallax). All animations honor prefers-reduced-motion.
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

const TYPING_TEXT = WORKSPACE_PROMPTS[2]; // "Compare share vs Q3"
const TARGET_PROMPT_IDX = 2;

type Stage =
  | "idle"
  | "cursor-to-chip"
  | "chip-clicked"
  | "typing"
  | "cursor-to-button"
  | "button-clicked"
  | "loading"
  | "output-ready";

const memoryGridVariants: Variants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.3 },
  },
};

const memoryCellVariants: Variants = {
  hidden: { opacity: 0, y: 8, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
  },
};

const ARTIFACTS = [
  { label: "deck.pptx", tone: "blue" as const },
  { label: "narrative_report.md", tone: "amber" as const },
  { label: "data_tables.xlsx", tone: "green" as const },
];

export function MotionWorkspaceMockup() {
  const rootRef = useRef<HTMLElement>(null);
  const chipRef = useRef<HTMLLIElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isInView, setIsInView] = useState(false);
  const [typedText, setTypedText] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const reducedMotion = usePrefersReducedMotion();

  // Compute cursor target pixel coords from refs whenever the stage changes.
  useEffect(() => {
    if (!rootRef.current) return;
    const rootRect = rootRef.current.getBoundingClientRect();

    const targetEl =
      stage === "cursor-to-chip" || stage === "chip-clicked" || stage === "typing"
        ? chipRef.current
        : stage === "cursor-to-button" || stage === "button-clicked" || stage === "loading"
          ? buttonRef.current
          : null;

    if (!targetEl) return;
    const tRect = targetEl.getBoundingClientRect();
    // Cursor TIP is at top-left of the SVG. Aim slightly inside the target so
    // the tip lands on the centre-ish of the element.
    const x = tRect.left - rootRect.left + tRect.width * 0.5 - 4;
    const y = tRect.top - rootRect.top + tRect.height * 0.5 - 4;
    setCursorPos({ x, y });
  }, [stage]);

  // Trigger the sequence as soon as the mockup is visible. We use both
  // IntersectionObserver and a scroll-event-listener fallback because
  // motion's useInView and pure observer-based gates have failed to fire
  // reliably in this stack (React 19 strict mode + Next 15 + motion v12).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    let triggered = false;
    const fire = () => {
      if (triggered) return;
      triggered = true;
      setIsInView(true);
    };

    const check = () => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.9 && rect.bottom > 0) {
        fire();
        window.removeEventListener("scroll", check, { capture: true } as never);
        if (obs) obs.disconnect();
      }
    };

    let obs: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      obs = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) fire();
          }
        },
        { threshold: 0.1, rootMargin: "0px 0px -10% 0px" },
      );
      obs.observe(el);
    }
    window.addEventListener("scroll", check, { passive: true });
    // Run an immediate check on mount in case the element is already in view.
    check();

    return () => {
      window.removeEventListener("scroll", check);
      if (obs) obs.disconnect();
    };
  }, []);

  // Run the scripted sequence after viewport enter.
  useEffect(() => {
    if (!isInView) return;

    if (reducedMotion) {
      setTypedText(TYPING_TEXT);
      setStage("output-ready");
      return;
    }

    const timers: number[] = [];

    timers.push(
      window.setTimeout(() => setStage("cursor-to-chip"), 600),
      window.setTimeout(() => setStage("chip-clicked"), 1500),
      window.setTimeout(() => {
        setStage("typing");
        let i = 0;
        const tick = () => {
          i += 1;
          setTypedText(TYPING_TEXT.slice(0, i));
          if (i < TYPING_TEXT.length) {
            const jitter = 24 + Math.random() * 14;
            timers.push(window.setTimeout(tick, jitter));
          }
        };
        tick();
      }, 1800),
      window.setTimeout(() => setStage("cursor-to-button"), 3400),
      window.setTimeout(() => setStage("button-clicked"), 4200),
      window.setTimeout(() => setStage("loading"), 4400),
      window.setTimeout(() => setStage("output-ready"), 5400),
    );

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [isInView, reducedMotion]);

  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (reducedMotion) return;
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const rotX = (0.5 - py) * 2.4;
    const rotY = (px - 0.5) * 2.4;
    target.style.setProperty("--mockup-rot-x", `${rotX}deg`);
    target.style.setProperty("--mockup-rot-y", `${rotY}deg`);
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    const target = e.currentTarget as HTMLElement;
    target.style.setProperty("--mockup-rot-x", "0deg");
    target.style.setProperty("--mockup-rot-y", "0deg");
  };

  const cursorVisible =
    stage !== "idle" && stage !== "output-ready" && !reducedMotion;

  return (
    <article
      ref={rootRef}
      className="workspace-mockup workspace-mockup-motion"
      aria-label="Example Basquio workspace running an output"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Animated cursor sprite. Position is computed in pixels from the
          refs of the chip and the button so the cursor lands on the actual
          element regardless of the mockup width. */}
      {cursorVisible && (
        <motion.span
          className="workspace-mockup-cursor"
          aria-hidden="true"
          initial={{ opacity: 0, x: 0, y: 0 }}
          animate={{ opacity: 1, x: cursorPos.x, y: cursorPos.y }}
          transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
        >
          <CursorIcon />
        </motion.span>
      )}

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

        {/* Output reveal beneath memory grid */}
        <div
          className={`workspace-mockup-output${stage === "output-ready" ? " workspace-mockup-output-visible" : ""}`}
          aria-live="polite"
        >
          <p className="workspace-mockup-output-label">
            <span className="workspace-mockup-output-dot" aria-hidden="true" />
            Output ready · 1m 58s
          </p>
          <ul className="workspace-mockup-artifacts">
            {ARTIFACTS.map((a, i) => (
              <li
                key={a.label}
                className={`workspace-mockup-artifact workspace-mockup-artifact-${a.tone}`}
                style={{ transitionDelay: `${i * 90}ms` }}
              >
                <span className="workspace-mockup-artifact-glyph" aria-hidden="true" />
                {a.label}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <aside className="workspace-mockup-chat">
        <p className="workspace-mockup-chat-title">Ask Basquio</p>
        <ul className="workspace-mockup-chat-suggestions">
          {WORKSPACE_PROMPTS.map((p, i) => (
            <li
              key={p}
              ref={i === TARGET_PROMPT_IDX ? chipRef : undefined}
              className={`workspace-mockup-chat-suggestion${
                i === TARGET_PROMPT_IDX && (stage === "chip-clicked" || stage === "typing")
                  ? " workspace-mockup-chat-suggestion-active"
                  : ""
              }`}
            >
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
            {stage === "typing" && (
              <span className="workspace-mockup-chat-caret" aria-hidden="true" />
            )}
          </span>
        </div>
        <button
          ref={buttonRef}
          type="button"
          className={`workspace-mockup-chat-cta${
            stage === "button-clicked" ? " workspace-mockup-chat-cta-pressed" : ""
          }${stage === "loading" ? " workspace-mockup-chat-cta-loading" : ""}${
            stage === "output-ready" ? " workspace-mockup-chat-cta-done" : ""
          }`}
          tabIndex={-1}
        >
          {stage === "loading" ? (
            <>
              <span className="workspace-mockup-spinner" aria-hidden="true" />
              Running
            </>
          ) : stage === "output-ready" ? (
            <>
              <span className="workspace-mockup-check" aria-hidden="true">
                ✓
              </span>
              Done
            </>
          ) : (
            <>
              Run output <span aria-hidden="true">→</span>
            </>
          )}
        </button>
        <p className="workspace-mockup-chat-trust">No training on customer data</p>
      </aside>
    </article>
  );
}

function CursorIcon() {
  return (
    <svg width="22" height="24" viewBox="0 0 22 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2 1.5L20 11L11.5 13L8 21.5L2 1.5Z"
        fill="#0B0C0C"
        stroke="#FFFFFF"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
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
