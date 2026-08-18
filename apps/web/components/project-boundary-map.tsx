"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Box, LocateFixed, Map as MapIcon, Search, X } from "lucide-react";
import { adminApi, adminErrorMessage } from "@/lib/api";
import { googleMapsBrowserKey, loadGoogleMaps } from "@/lib/google-maps";

type Point = { lat: number; lng: number };
type Center = { lat: number; lng: number } | null;
type PlaceResult = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
};
type ViewMode = "EDIT" | "3D";

function centroid(points: Point[], fallback?: Center): Point {
  if (points.length) {
    const total = points.reduce((acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }), { lat: 0, lng: 0 });
    return { lat: total.lat / points.length, lng: total.lng / points.length };
  }
  return fallback ?? { lat: 30.0444, lng: 31.2357 };
}

function rangeFor(points: Point[]) {
  if (points.length < 2) return 1400;
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const latMeters = (Math.max(...lats) - Math.min(...lats)) * 111_320;
  const lngMeters = (Math.max(...lngs) - Math.min(...lngs)) * 111_320 * Math.cos((centroid(points).lat * Math.PI) / 180);
  const span = Math.max(latMeters, Math.abs(lngMeters));
  return Math.max(650, Math.min(18_000, span * 3.2 || 1400));
}

export function ProjectBoundaryMap({ points, onChange, center }: { points: Point[]; onChange: (points: Point[]) => void; center?: Center }) {
  const editElementRef = useRef<HTMLDivElement>(null);
  const view3dElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const map3dRef = useRef<any>(null);
  const polygonRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);
  const markerRefs = useRef<any[]>([]);
  const pointsRef = useRef(points);
  const onChangeRef = useRef(onChange);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<ViewMode>(points.length >= 3 ? "3D" : "EDIT");
  const [searchText, setSearchText] = useState("");
  const [searching, setSearching] = useState(false);
  const [places, setPlaces] = useState<PlaceResult[]>([]);
  const key = googleMapsBrowserKey();
  const projectCenter = useMemo(() => centroid(points, center), [points, center]);

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
    if (mode !== "EDIT" || !key || !editElementRef.current) return;
    let active = true;
    let clickListener: any;
    void loadGoogleMaps(key).then((maps) => {
      if (!active || !editElementRef.current) return;
      const initial = pointsRef.current[0] || center || { lat: 30.0444, lng: 31.2357 };
      const map = new maps.Map(editElementRef.current, {
        center: initial,
        zoom: pointsRef.current.length ? 16 : 12,
        mapTypeControl: true,
        mapTypeControlOptions: { mapTypeIds: ["roadmap", "satellite", "hybrid"] },
        streetViewControl: false,
        fullscreenControl: true,
        clickableIcons: true,
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
  }, [key, mode, center]);

  useEffect(() => {
    if (mode !== "EDIT") return;
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
  }, [points, ready, mode]);

  useEffect(() => {
    if (mode !== "3D" || !key || !view3dElementRef.current) return;
    let active = true;
    const host = view3dElementRef.current;
    host.replaceChildren();
    setError("");
    void loadGoogleMaps(key).then(async () => {
      if (!active || !host) return;
      const library = await window.google.maps.importLibrary("maps3d") as any;
      if (!active) return;
      const { Map3DElement, Polygon3DElement, Marker3DElement } = library;
      const map3d = new Map3DElement({
        center: { ...projectCenter, altitude: Math.max(60, rangeFor(points) * 0.08) },
        range: rangeFor(points),
        tilt: 68,
        heading: 0,
        mode: "HYBRID",
        gestureHandling: "GREEDY",
      });
      map3d.style.width = "100%";
      map3d.style.height = "100%";
      map3dRef.current = map3d;
      host.append(map3d);

      if (points.length >= 3 && Polygon3DElement) {
        const polygon = new Polygon3DElement({
          strokeColor: "#8a6630",
          strokeWidth: 5,
          fillColor: "#b08c524d",
          drawsOccludedSegments: true,
        });
        polygon.path = points.map((point) => ({ ...point, altitude: 2 }));
        map3d.append(polygon);
      }
      if (Marker3DElement) {
        points.forEach((point, index) => {
          const marker = new Marker3DElement({ position: { ...point, altitude: 6 }, label: String(index + 1), drawsWhenOccluded: true, sizePreserved: true });
          map3d.append(marker);
        });
      }
    }).catch((reason) => active && setError(reason instanceof Error ? reason.message : "تعذر فتح العرض ثلاثي الأبعاد."));
    return () => { active = false; map3dRef.current = null; host.replaceChildren(); };
  }, [mode, key, projectCenter.lat, projectCenter.lng, points]);

  function moveTo(point: Point, zoom = 17) {
    if (mode === "EDIT" && mapRef.current) {
      mapRef.current.panTo(point);
      mapRef.current.setZoom(zoom);
    }
    if (mode === "3D" && map3dRef.current) {
      map3dRef.current.center = { ...point, altitude: 70 };
      map3dRef.current.range = zoom >= 18 ? 550 : 1000;
      map3dRef.current.tilt = 68;
    }
  }

  function returnToProject() {
    moveTo(projectCenter, points.length >= 3 ? 17 : 14);
    if (mode === "3D" && map3dRef.current) map3dRef.current.range = rangeFor(points);
  }

  async function searchPlaces(event: FormEvent) {
    event.preventDefault();
    const query = searchText.trim();
    if (!query) return;
    try {
      setSearching(true); setError("");
      const response = await adminApi.get<{ places?: PlaceResult[] }>(`/maps/places?query=${encodeURIComponent(query)}`);
      const next = Array.isArray(response.places) ? response.places.slice(0, 6) : [];
      setPlaces(next);
      const first = next[0]?.location;
      if (first && Number.isFinite(Number(first.latitude)) && Number.isFinite(Number(first.longitude))) moveTo({ lat: Number(first.latitude), lng: Number(first.longitude) }, 17);
    } catch (reason) { setError(adminErrorMessage(reason)); } finally { setSearching(false); }
  }

  function choosePlace(place: PlaceResult) {
    const latitude = Number(place.location?.latitude);
    const longitude = Number(place.location?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    moveTo({ lat: latitude, lng: longitude }, 18);
    setSearchText(place.displayName?.text || place.formattedAddress || searchText);
    setPlaces([]);
  }

  if (!key) {
    return (
      <div className="grid min-h-[340px] place-items-center rounded-[22px] border border-dashed bg-[#f5f2eb] p-6 text-center">
        <div className="max-w-md"><p className="font-bold">الخريطة جاهزة للكود لكنها تحتاج Browser API Key</p><p className="mt-2 text-sm leading-7 text-[#68756f]">أضف <code className="rounded bg-white px-1.5 py-1" dir="ltr">NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY</code> بمفتاح مقيد على دومين Cg Ai. مفتاح السيرفر الحالي لا يتم كشفه للمتصفح.</p></div>
      </div>
    );
  }

  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex flex-col gap-2 rounded-2xl border bg-[#faf9f5] p-2.5 lg:flex-row lg:items-start lg:justify-between">
        <form onSubmit={searchPlaces} className="relative flex min-w-0 flex-1 gap-2">
          <div className="relative min-w-0 flex-1"><Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#77847e]"/><input value={searchText} onChange={(event) => { setSearchText(event.target.value); if (!event.target.value) setPlaces([]); }} placeholder="ابحث عن طريق، كمبوند، جامعة، معلم…" className="h-11 w-full rounded-xl border bg-white pr-10 pl-9 text-sm" />{searchText ? <button type="button" onClick={() => { setSearchText(""); setPlaces([]); }} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7d8984]"><X size={14}/></button> : null}</div>
          <button disabled={searching || !searchText.trim()} className="h-11 rounded-xl bg-[#173f3b] px-4 text-sm font-black text-white disabled:opacity-40">{searching ? "بحث…" : "بحث"}</button>
          {places.length ? <div className="absolute right-0 top-12 z-30 w-[min(620px,calc(100vw-4rem))] overflow-hidden rounded-2xl border bg-white shadow-xl">{places.map((place, index) => <button type="button" key={place.id || index} onClick={() => choosePlace(place)} className="block w-full border-b px-4 py-3 text-right last:border-0 hover:bg-[#f6f7f4]"><b className="block text-sm">{place.displayName?.text || "نتيجة"}</b><span className="mt-1 block text-xs text-[#74817b]">{place.formattedAddress || ""}</span></button>)}</div> : null}
        </form>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={returnToProject} className="inline-flex h-11 items-center gap-2 rounded-xl border bg-white px-3 text-xs font-black"><LocateFixed size={15}/>ارجع للمشروع</button>
          <div className="inline-flex rounded-xl border bg-white p-1"><button type="button" onClick={() => setMode("EDIT")} className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-black ${mode === "EDIT" ? "bg-[#173f3b] text-white" : "text-[#5d6b66]"}`}><MapIcon size={14}/>تحرير 2D</button><button type="button" disabled={points.length < 3} onClick={() => setMode("3D")} className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-black disabled:opacity-35 ${mode === "3D" ? "bg-[#173f3b] text-white" : "text-[#5d6b66]"}`}><Box size={14}/>عرض 3D</button></div>
        </div>
      </div>
      {error && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {mode === "EDIT" ? <div ref={editElementRef} className="min-h-[420px] w-full overflow-hidden rounded-[22px] border bg-[#e9ece8] sm:min-h-[500px]" /> : <div ref={view3dElementRef} className="min-h-[480px] w-full overflow-hidden rounded-[22px] border bg-[#dfe5df] sm:min-h-[570px]" />}
      <p className="text-xs leading-6 text-[#68756f]">{mode === "EDIT" ? "وضع التحرير: اضغط لإضافة نقاط، وبعد 3 نقاط اسحب رؤوس الـPolygon بدقة. البحث يحرك الخريطة فقط ولا يغيّر حدود المشروع." : "وضع 3D: حرّك ولفّ وميّل الكاميرا واستعمل Zoom لفهم الموقع والمباني بصريًا. لتعديل حدود المشروع ارجع إلى تحرير 2D."}</p>
    </div>
  );
}
