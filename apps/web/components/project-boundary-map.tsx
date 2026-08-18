"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Hand, LocateFixed, Map as MapIcon, Satellite, Search, X } from "lucide-react";
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
type ToolMode = "DRAW" | "PAN";
type BaseMapMode = "ROAD" | "SATELLITE";

function centroid(points: Point[], fallback?: Center): Point {
  if (points.length) {
    const total = points.reduce(
      (acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }),
      { lat: 0, lng: 0 },
    );
    return { lat: total.lat / points.length, lng: total.lng / points.length };
  }
  return fallback ?? { lat: 30.0444, lng: 31.2357 };
}

export function ProjectBoundaryMap({
  points,
  onChange,
  center,
}: {
  points: Point[];
  onChange: (points: Point[]) => void;
  center?: Center;
}) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const polygonRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);
  const markerRefs = useRef<any[]>([]);
  const pointsRef = useRef(points);
  const onChangeRef = useRef(onChange);
  const toolModeRef = useRef<ToolMode>("DRAW");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [toolMode, setToolMode] = useState<ToolMode>("DRAW");
  const [baseMapMode, setBaseMapMode] = useState<BaseMapMode>("SATELLITE");
  const [searchText, setSearchText] = useState("");
  const [searching, setSearching] = useState(false);
  const [places, setPlaces] = useState<PlaceResult[]>([]);
  const key = googleMapsBrowserKey();
  const projectCenter = useMemo(() => centroid(points, center), [points, center]);

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    toolModeRef.current = toolMode;
    const map = mapRef.current;
    if (!map) return;
    map.setOptions({
      draggable: toolMode === "PAN",
      gestureHandling: toolMode === "PAN" ? "greedy" : "none",
      scrollwheel: toolMode === "PAN",
      disableDoubleClickZoom: toolMode === "DRAW",
      draggableCursor: toolMode === "DRAW" ? "crosshair" : undefined,
      draggingCursor: toolMode === "DRAW" ? "crosshair" : undefined,
    });
  }, [toolMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setMapTypeId(baseMapMode === "SATELLITE" ? "hybrid" : "roadmap");
  }, [baseMapMode]);

  useEffect(() => {
    const handler = (event: Event) => {
      const message =
        (event as CustomEvent<string>).detail || "Google Maps authentication failed.";
      setError(message);
    };
    window.addEventListener("cg-google-maps-auth-failure", handler);
    return () => window.removeEventListener("cg-google-maps-auth-failure", handler);
  }, []);

  useEffect(() => {
    if (!key || !mapElementRef.current) return;
    let active = true;
    let clickListener: any;

    void loadGoogleMaps(key)
      .then((maps) => {
        if (!active || !mapElementRef.current) return;
        const initial = pointsRef.current[0] || center || { lat: 30.0444, lng: 31.2357 };
        const map = new maps.Map(mapElementRef.current, {
          center: initial,
          zoom: pointsRef.current.length ? 17 : 12,
          mapTypeId: baseMapMode === "SATELLITE" ? "hybrid" : "roadmap",
          mapTypeControl: false,
          streetViewControl: true,
          fullscreenControl: true,
          zoomControl: true,
          clickableIcons: true,
          draggable: false,
          gestureHandling: "none",
          scrollwheel: false,
          disableDoubleClickZoom: true,
          draggableCursor: "crosshair",
          draggingCursor: "crosshair",
        });

        mapRef.current = map;
        setReady(true);

        clickListener = map.addListener("click", (event: any) => {
          if (toolModeRef.current !== "DRAW") return;
          const lat = event.latLng?.lat?.();
          const lng = event.latLng?.lng?.();
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
          onChangeRef.current([...pointsRef.current, { lat, lng }]);
        });

        if (pointsRef.current.length >= 2) {
          const bounds = new maps.LatLngBounds();
          pointsRef.current.forEach((point) => bounds.extend(point));
          map.fitBounds(bounds, 56);
        }
      })
      .catch((reason) =>
        active && setError(reason instanceof Error ? reason.message : "تعذر فتح الخريطة."),
      );

    return () => {
      active = false;
      clickListener?.remove?.();
      mapRef.current = null;
      setReady(false);
    };
    // Initialize the map once for this browser key/initial center. Map type/tool changes
    // are applied through setOptions/setMapTypeId so we never destroy the current view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const maps = window.google?.maps;
    const map = mapRef.current;
    if (!maps || !map || !ready) return;

    polygonRef.current?.setMap?.(null);
    polylineRef.current?.setMap?.(null);
    markerRefs.current.forEach((marker) => marker.setMap?.(null));
    markerRefs.current = [];

    for (const [index, point] of points.entries()) {
      markerRefs.current.push(
        new maps.Marker({
          map,
          position: point,
          label: {
            text: String(index + 1),
            color: "#14211f",
            fontWeight: "700",
            fontSize: "11px",
          },
          title: `Boundary point ${index + 1}`,
        }),
      );
    }

    if (points.length >= 3) {
      const polygon = new maps.Polygon({
        map,
        paths: points,
        editable: toolMode === "DRAW",
        clickable: true,
        strokeColor: "#7c6238",
        strokeOpacity: 0.98,
        strokeWeight: 3,
        fillColor: "#b08c52",
        fillOpacity: 0.16,
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
        strokeOpacity: 0.98,
        strokeWeight: 3,
      });
    }
  }, [points, ready, toolMode]);

  function moveTo(point: Point, zoom = 18) {
    const map = mapRef.current;
    if (!map) return;
    map.panTo(point);
    map.setZoom(zoom);
  }

  function returnToProject() {
    moveTo(projectCenter, points.length >= 3 ? 18 : 15);
  }

  async function searchPlaces(event: FormEvent) {
    event.preventDefault();
    const query = searchText.trim();
    if (!query) return;
    try {
      setSearching(true);
      setError("");
      const response = await adminApi.get<{ places?: PlaceResult[] }>(
        `/maps/places?query=${encodeURIComponent(query)}`,
      );
      const next = Array.isArray(response.places) ? response.places.slice(0, 6) : [];
      setPlaces(next);
      const first = next[0]?.location;
      if (
        first &&
        Number.isFinite(Number(first.latitude)) &&
        Number.isFinite(Number(first.longitude))
      ) {
        moveTo({ lat: Number(first.latitude), lng: Number(first.longitude) }, 18);
      }
    } catch (reason) {
      setError(adminErrorMessage(reason));
    } finally {
      setSearching(false);
    }
  }

  function choosePlace(place: PlaceResult) {
    const latitude = Number(place.location?.latitude);
    const longitude = Number(place.location?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    moveTo({ lat: latitude, lng: longitude }, 19);
    setSearchText(place.displayName?.text || place.formattedAddress || searchText);
    setPlaces([]);
  }

  if (!key) {
    return (
      <div className="grid min-h-[340px] place-items-center rounded-[22px] border border-dashed bg-[#f5f2eb] p-6 text-center">
        <div className="max-w-md">
          <p className="font-bold">الخريطة جاهزة للكود لكنها تحتاج Browser API Key</p>
          <p className="mt-2 text-sm leading-7 text-[#68756f]">
            أضف{" "}
            <code className="rounded bg-white px-1.5 py-1" dir="ltr">
              NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY
            </code>{" "}
            بمفتاح مقيد على دومين Cg Ai. مفتاح السيرفر لا يتم كشفه للمتصفح.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" dir="rtl">
      <div className="rounded-2xl border bg-[#faf9f5] p-2.5">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
          <form onSubmit={searchPlaces} className="relative flex min-w-0 flex-1 gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                size={16}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#77847e]"
              />
              <input
                value={searchText}
                onChange={(event) => {
                  setSearchText(event.target.value);
                  if (!event.target.value) setPlaces([]);
                }}
                placeholder="ابحث عن طريق، كمبوند، جامعة، معلم…"
                className="h-11 w-full rounded-xl border bg-white pr-10 pl-9 text-sm"
              />
              {searchText ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchText("");
                    setPlaces([]);
                  }}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7d8984]"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
            <button
              disabled={searching || !searchText.trim()}
              className="h-11 rounded-xl bg-[#173f3b] px-4 text-sm font-black text-white disabled:opacity-40"
            >
              {searching ? "بحث…" : "بحث"}
            </button>
            {places.length ? (
              <div className="absolute right-0 top-12 z-30 w-[min(620px,calc(100vw-4rem))] overflow-hidden rounded-2xl border bg-white shadow-xl">
                {places.map((place, index) => (
                  <button
                    type="button"
                    key={place.id || index}
                    onClick={() => choosePlace(place)}
                    className="block w-full border-b px-4 py-3 text-right last:border-0 hover:bg-[#f6f7f4]"
                  >
                    <b className="block text-sm">{place.displayName?.text || "نتيجة"}</b>
                    <span className="mt-1 block text-xs text-[#74817b]">
                      {place.formattedAddress || ""}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </form>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={returnToProject}
              className="inline-flex h-11 items-center gap-2 rounded-xl border bg-white px-3 text-xs font-black"
            >
              <LocateFixed size={15} />
              ارجع للمشروع
            </button>

            <div className="inline-flex rounded-xl border bg-white p-1">
              <button
                type="button"
                onClick={() => setBaseMapMode("ROAD")}
                className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-black ${
                  baseMapMode === "ROAD" ? "bg-[#173f3b] text-white" : "text-[#5d6b66]"
                }`}
              >
                <MapIcon size={14} />
                خريطة
              </button>
              <button
                type="button"
                onClick={() => setBaseMapMode("SATELLITE")}
                className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-black ${
                  baseMapMode === "SATELLITE"
                    ? "bg-[#173f3b] text-white"
                    : "text-[#5d6b66]"
                }`}
              >
                <Satellite size={14} />
                Satellite + معالم
              </button>
            </div>

            <div className="inline-flex rounded-xl border bg-white p-1">
              <button
                type="button"
                onClick={() => setToolMode("DRAW")}
                className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-black ${
                  toolMode === "DRAW" ? "bg-[#b08c52] text-white" : "text-[#5d6b66]"
                }`}
              >
                <Crosshair size={14} />
                تحديد الحدود
              </button>
              <button
                type="button"
                onClick={() => setToolMode("PAN")}
                className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-black ${
                  toolMode === "PAN" ? "bg-[#173f3b] text-white" : "text-[#5d6b66]"
                }`}
              >
                <Hand size={14} />
                تحريك
              </button>
            </div>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      <div
        ref={mapElementRef}
        className="min-h-[450px] w-full overflow-hidden rounded-[22px] border bg-[#e9ece8] sm:min-h-[560px]"
      />

      <div
        className={`rounded-2xl border px-4 py-3 text-xs leading-6 ${
          toolMode === "DRAW"
            ? "border-[#d9c18f] bg-[#fff8e8] text-[#765b2d]"
            : "bg-[#f5f4ef] text-[#68756f]"
        }`}
      >
        {toolMode === "DRAW" ? (
          <>
            <b>وضع تحديد الحدود فعال.</b> كل ضغطة على الخريطة تضيف نقطة. أثناء هذا الوضع تم
            إيقاف سحب الخريطة عمدًا حتى لا تتحول الضغطة إلى حركة. استخدم البحث للوصول للمكان أو
            انتقل إلى <b>تحريك</b> للتنقل، ثم ارجع إلى <b>تحديد الحدود</b> لإكمال الرسم.
          </>
        ) : (
          <>
            <b>وضع التحريك فعال.</b> اسحب وزوّم بحرية للوصول للمكان المطلوب، ثم اضغط <b>تحديد
            الحدود</b> لإضافة النقاط. وضع Satellite + معالم يظل قابلًا للرسم ويعرض صور القمر الصناعي
            مع أسماء الطرق والمعالم.
          </>
        )}
      </div>
    </div>
  );
}
