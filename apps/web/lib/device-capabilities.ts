/**
 * Device Capability Detection
 *
 * Detect device capabilities to optimize performance by disabling
 * expensive features on low-end devices.
 */

/**
 * Check if browser supports backdrop-filter
 */
export function supportsBackdropFilter(): boolean {
  if (typeof window === 'undefined') return true;
  if (typeof CSS === 'undefined') return false;
  return CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)');
}

/**
 * Detect low-end device using hardware heuristics
 *
 * Heuristics:
 * - <4 CPU cores
 * - <4GB RAM (Chrome/Edge only)
 * - Slow connection (navigator.connection.effectiveType)
 */
export function isLowEndDevice(): boolean {
  if (typeof window === 'undefined') return false;

  // CPU cores check
  const cores = navigator.hardwareConcurrency || 4;
  if (cores < 4) return true;

  // Memory check (Chrome/Edge only)
  const nav = navigator as any;
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 4) return true;

  // Connection speed check
  const connection = nav.connection || nav.mozConnection || nav.webkitConnection;
  if (connection?.effectiveType === '2g' || connection?.effectiveType === 'slow-2g') return true;

  return false;
}

/**
 * Check if reduced motion is preferred (accessibility)
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Check if reduced transparency is preferred (accessibility)
 */
export function prefersReducedTransparency(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
}

/**
 * Determine if glass effects (backdrop-filter blur) should be used
 *
 * Disables glass effects if:
 * - Browser doesn't support backdrop-filter
 * - Device is low-end (performance concern)
 * - User prefers reduced transparency (accessibility)
 */
export function shouldUseGlassEffects(): boolean {
  return supportsBackdropFilter() && !isLowEndDevice() && !prefersReducedTransparency();
}

/**
 * Get recommended animation duration multiplier
 *
 * Returns:
 * - 0 if reduced motion preferred (animations disabled)
 * - 0.5 if low-end device (faster animations)
 * - 1 otherwise (normal speed)
 */
export function getAnimationDurationMultiplier(): number {
  if (prefersReducedMotion()) return 0;
  if (isLowEndDevice()) return 0.5;
  return 1;
}

/**
 * Performance monitoring: Measure scroll FPS
 *
 * Calls callback with average FPS every second.
 * Returns cleanup function to stop monitoring.
 */
export function monitorScrollFPS(callback: (fps: number) => void): () => void {
  let frameCount = 0;
  let lastTime = performance.now();
  let rafId: number;

  function tick() {
    frameCount++;
    const now = performance.now();

    if (now >= lastTime + 1000) {
      const fps = Math.round((frameCount * 1000) / (now - lastTime));
      callback(fps);

      frameCount = 0;
      lastTime = now;
    }

    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);

  return () => cancelAnimationFrame(rafId);
}
