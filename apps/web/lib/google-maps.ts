"use client";

declare global {
  interface Window {
    google?: any;
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
    const existing = document.querySelector<HTMLScriptElement>("script[data-cg-google-maps]");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.google?.maps));
      existing.addEventListener("error", () => reject(new Error("تعذر تحميل Google Maps.")));
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.dataset.cgGoogleMaps = "true";
    script.onload = () => window.google?.maps ? resolve(window.google.maps) : reject(new Error("Google Maps لم يبدأ بشكل صحيح."));
    script.onerror = () => reject(new Error("تعذر تحميل Google Maps."));
    document.head.appendChild(script);
  });

  return mapsLoader;
}
