"use client";

import { useEffect, useRef, useState } from "react";
import { googleMapsBrowserKey, loadGoogleMaps } from "@/lib/google-maps";

type Point = { lat: number; lng: number } | null;

export function MapPointPicker({ value, onChange }: { value: Point; onChange: (value: Exclude<Point, null>) => void }) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const valueRef = useRef<Point>(value);
  const onChangeRef = useRef(onChange);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const key = googleMapsBrowserKey();

  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!key || !elementRef.current) return;
    let active = true;
    let clickListener: any;
    void loadGoogleMaps(key).then((maps) => {
      if (!active || !elementRef.current) return;
      const initial = valueRef.current || { lat: 30.0444, lng: 31.2357 };
      const map = new maps.Map(elementRef.current, {
        center: initial,
        zoom: valueRef.current ? 15 : 10,
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
        if (Number.isFinite(lat) && Number.isFinite(lng)) onChangeRef.current({ lat, lng });
      });
    }).catch((reason) => active && setError(reason instanceof Error ? reason.message : "تعذر فتح الخريطة."));

    return () => {
      active = false;
      clickListener?.remove?.();
      markerRef.current?.setMap?.(null);
      markerRef.current = null;
      mapRef.current = null;
      setReady(false);
    };
  }, [key]);

  useEffect(() => {
    const maps = window.google?.maps;
    const map = mapRef.current;
    if (!ready || !maps || !map || !value) return;

    if (!markerRef.current) {
      const marker = new maps.Marker({ map, position: value, draggable: true, title: "Cg Ai location" });
      marker.addListener("dragend", (event: any) => {
        const lat = event.latLng?.lat?.();
        const lng = event.latLng?.lng?.();
        if (Number.isFinite(lat) && Number.isFinite(lng)) onChangeRef.current({ lat, lng });
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setPosition(value);
    }
    map.panTo(value);
  }, [value, ready]);

  if (!key) {
    return <div className="rounded-2xl border border-dashed bg-[#f5f2eb] p-4 text-sm leading-7 text-[#68756f]">أضف <code dir="ltr">NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY</code> ليتحول تحديد الموقع إلى اختيار مباشر على الخريطة.</div>;
  }

  return <div className="space-y-2">{error && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}<div ref={elementRef} className="min-h-[300px] w-full overflow-hidden rounded-[20px] border bg-[#e9ece8]"/><p className="text-xs leading-6 text-[#68756f]">اضغط مكان النقطة أو اسحب العلامة. الإحداثيات تحفظ تلقائيًا ولا تحتاج كتابتها يدويًا.</p></div>;
}
