import { useEffect, useRef } from "react";

let dataP: Promise<unknown> | null = null;
let libP: Promise<typeof import("lottie-web")["default"]> | null = null;

/** The AI orb (Lottie). Loaded on first use so it never weighs down the main bundle. */
export function AiOrb({ size = 40 }: { size?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let anim: { destroy: () => void; goToAndStop: (f: number, isFrame: boolean) => void } | null = null;
    let dead = false;
    dataP ??= fetch("/anim/ai-orb.json").then((r) => r.json());
    libP ??= import("lottie-web/build/player/lottie_svg").then((m) => (m as unknown as { default: typeof import("lottie-web")["default"] }).default);
    Promise.all([libP, dataP]).then(([lottie, data]) => {
      if (dead || !ref.current) return;
      const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      anim = lottie.loadAnimation({ container: ref.current, renderer: "svg", loop: true, autoplay: !still, animationData: data,
        rendererSettings: { preserveAspectRatio: "xMidYMid meet" } });
      if (still) anim.goToAndStop(100, true);
    }).catch(() => {});
    return () => { dead = true; anim?.destroy(); };
  }, []);
  return <span ref={ref} className="ai-orb" style={{ width: size, height: size }} aria-hidden="true" />;
}
