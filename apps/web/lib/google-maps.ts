"use client";

declare global {
  interface Window {
    google?: any;
    gm_authFailure?: () => void;
  }
}

let mapsLoader: Promise<any> | null = null;

export function googleMapsBrowserKey() {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY || "";
}

export function loadGoogleMaps(key = googleMapsBrowserKey()) {
  if (typeof window === "undefined") return Promise.reject(new Error("Maps needs a browser."));
  if (!key) return Promise.reject(new Error("NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY is missing."));
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (mapsLoader) return mapsLoader;

  mapsLoader = new Promise((resolve, reject) => {
    let settled = false;
    const fail = (message: string) => {
      window.dispatchEvent(new CustomEvent("cg-google-maps-auth-failure", { detail: message }));
      if (!settled) {
        settled = true;
        mapsLoader = null;
        reject(new Error(message));
      }
    };
    window.gm_authFailure = () => fail("Google Maps رفض Browser API Key. راجع تفعيل Maps JavaScript API وBilling وHTTP referrer للدومين الحالي.");

    const existing = document.querySelector<HTMLScriptElement>("script[data-cg-google-maps]");
    if (existing) {
      existing.addEventListener("load", () => {
        if (window.google?.maps && !settled) { settled = true; resolve(window.google.maps); }
      }, { once: true });
      existing.addEventListener("error", () => fail("تعذر تحميل Google Maps JavaScript API."), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async`;
    script.async = true;
    script.dataset.cgGoogleMaps = "true";
    script.onload = () => {
      if (window.google?.maps && !settled) { settled = true; resolve(window.google.maps); }
      else if (!settled) fail("Google Maps script loaded but the Maps API did not initialize.");
    };
    script.onerror = () => fail("تعذر تحميل Google Maps JavaScript API.");
    document.head.appendChild(script);
  });

  return mapsLoader;
}
