"use client";

declare global {
  interface Window {
    google?: any;
    gm_authFailure?: () => void;
    __cgGoogleMapsReady?: () => void;
  }
}

let mapsLoader: Promise<any> | null = null;

export function googleMapsBrowserKey() {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY || "";
}

const activationMessage = "تعذر تفعيل خرائط Google. فعّل Maps JavaScript API في نفس Google Cloud Project الخاص بمفتاح المتصفح، وتأكد من Billing ومن Website/HTTP referrer restrictions للدومين الحالي.";

export function loadGoogleMaps(key = googleMapsBrowserKey()) {
  if (typeof window === "undefined") return Promise.reject(new Error("Maps needs a browser."));
  if (!key) return Promise.reject(new Error("NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY is missing."));
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (mapsLoader) return mapsLoader;

  mapsLoader = new Promise((resolve, reject) => {
    let settled = false;
    let timeout: number | undefined;
    const finish = () => {
      if (settled || !window.google?.maps) return;
      settled = true;
      if (timeout) window.clearTimeout(timeout);
      delete window.__cgGoogleMapsReady;
      resolve(window.google.maps);
    };
    const fail = (message: string) => {
      window.dispatchEvent(new CustomEvent("cg-google-maps-auth-failure", { detail: message }));
      if (!settled) {
        settled = true;
        if (timeout) window.clearTimeout(timeout);
        mapsLoader = null;
        delete window.__cgGoogleMapsReady;
        reject(new Error(message));
      }
    };

    // Google calls this hook for key/auth configuration failures, including project/API activation issues.
    window.gm_authFailure = () => fail(activationMessage);
    window.__cgGoogleMapsReady = finish;

    const existing = document.querySelector<HTMLScriptElement>("script[data-cg-google-maps]");
    if (existing) {
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener("error", () => fail("تعذر تحميل Google Maps JavaScript API."), { once: true });
      timeout = window.setTimeout(() => !settled && (window.google?.maps ? finish() : fail(activationMessage)), 12_000);
      return;
    }

    const script = document.createElement("script");
    const params = new URLSearchParams({
      key,
      v: "weekly",
      loading: "async",
      callback: "__cgGoogleMapsReady",
      auth_referrer_policy: "origin",
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.dataset.cgGoogleMaps = "true";
    script.onerror = () => fail("تعذر تحميل Google Maps JavaScript API.");
    document.head.appendChild(script);
    timeout = window.setTimeout(() => !settled && (window.google?.maps ? finish() : fail(activationMessage)), 12_000);
  });

  return mapsLoader;
}
