"use client";

import { useEffect, useRef, useState } from "react";
import { googleMapsBrowserKey, loadGoogleMaps } from "@/lib/google-maps";

type Point = { lat: number; lng: number };
type Center = { lat: number; lng: number } | null;

export function ProjectBoundaryMap({ points, onChange, center }: { points: Point[]; onChange: (points: Point[]) => void; center?: Center }) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const polygonRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);
  const markerRefs = useRef<any[]>([]);
  const pointsRef = useRef(points);
  const onChangeRef = useRef(onChange);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const key = googleMapsBrowserKey();

  useEffect(() => { pointsRef.current = points; }, [points]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => {
    const handler = (event: Event) => {
      const message = (event as CustomEvent<string>).detail || "Google Maps authentication failed.";
      setError(message);
    };
    window.addEventListener("cg-google-maps-auth-failure", handler);
    return () => window.removeEventListener("cg-google-maps-auth-failure", handler);
  }, []);

  useEffect(() => {
    if (!key || !elementRef.current) return;
    let active = true;
    let clickListener: any;
    void loadGoogleMaps(key).then((maps) => {
      if (!active || !elementRef.current) return;
      const initial = pointsRef.current[0] || center || { lat: 30.0444, lng: 31.2357 };
      const map = new maps.Map(elementRef.current, {
        center: initial,
        zoom: pointsRef.current.length ? 16 : 12,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
        gestureHandling: "greedy",
      });
      mapRef.current = map;
      setReady(true);
      clickListener = map.addListener("click", (event: any) => {
        const lat = event.latLng?.lat?.();
        const lng = event.latLng?.lng?.();
        if (Number.isFinite(lat) && Number.isFinite(lng)) onChangeRef.current([...pointsRef.current, { lat, lng }]);
      });
      if (pointsRef.current.length >= 2) {
        const bounds = new maps.LatLngBounds();
        pointsRef.current.forEach((point) => bounds.extend(point));
        map.fitBounds(bounds, 44);
      }
    }).catch((reason) => active && setError(reason instanceof Error ? reason.message : "تعذر فتح الخريطة."));
    return () => {
      active = false;
      clickListener?.remove?.();
      mapRef.current = null;
      setReady(false);
    };
  }, [key]); // Map is created once; points are synchronized in the next effect.

  useEffect(() => {
    const maps = window.google?.maps;
    const map = mapRef.current;
    if (!maps || !map) return;

    polygonRef.current?.setMap?.(null);
    polylineRef.current?.setMap?.(null);
    markerRefs.current.forEach((marker) => marker.setMap?.(null));
    markerRefs.current = [];

    for (const [index, point] of points.entries()) {
      markerRefs.current.push(new maps.Marker({
        map,
        position: point,
        label: { text: String(index + 1), color: "#14211f", fontWeight: "700", fontSize: "11px" },
        title: `Boundary point ${index + 1}`,
      }));
    }

    if (points.length >= 3) {
      const polygon = new maps.Polygon({
        map,
        paths: points,
        editable: true,
        clickable: true,
        strokeColor: "#7c6238",
        strokeOpacity: 0.95,
        strokeWeight: 2,
        fillColor: "#b08c52",
        fillOpacity: 0.13,
      });
      polygonRef.current = polygon;
      const path = polygon.getPath();
      const sync = () => {
        const next: Point[] = [];
        for (let index = 0; index < path.getLength(); index += 1) {
          const value = path.getAt(index);
          next.push({ lat: value.lat(), lng: value.lng() });
        }
        onChangeRef.current(next);
      };
      path.addListener("set_at", sync);
      path.addListener("insert_at", sync);
      path.addListener("remove_at", sync);
    } else if (points.length >= 2) {
      polylineRef.current = new maps.Polyline({
        map,
        path: points,
        strokeColor: "#7c6238",
        strokeOpacity: 0.95,
        strokeWeight: 2,
      });
    }
  }, [points, ready]);

  if (!key) {
    return (
      <div className="grid min-h-[340px] place-items-center rounded-[22px] border border-dashed bg-[#f5f2eb] p-6 text-center">
        <div className="max-w-md"><p className="font-bold">الخريطة جاهزة للكود لكنها تحتاج Browser API Key</p><p className="mt-2 text-sm leading-7 text-[#68756f]">أضف <code className="rounded bg-white px-1.5 py-1" dir="ltr">NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY</code> بمفتاح مقيد على دومين Cg Ai. مفتاح السيرفر الحالي لا يتم كشفه للمتصفح.</p></div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div ref={elementRef} className="min-h-[360px] w-full overflow-hidden rounded-[22px] border bg-[#e9ece8] sm:min-h-[430px]" />
      <p className="text-xs leading-6 text-[#68756f]">اضغط على الخريطة لإضافة نقاط الحدود. بعد 3 نقاط سيظهر Polygon ويمكنك سحب رؤوسه وتعديل الشكل مباشرة.</p>
    </div>
  );
}
