# Cg Ai — Boundary + Publish Trace Fix

## What changed

- Replaced the separate 3D map screen with one Google Maps canvas that can switch between:
  - Road map
  - `HYBRID` satellite imagery with labels/landmarks
- Added an explicit interaction tool:
  - `تحديد الحدود`: disables dragging so every click/tap adds a boundary point.
  - `تحريك`: enables normal drag/zoom navigation.
- Search remains available in both modes and only moves the camera.
- Publishing is now a second step after saving:
  1. Save project/phase/boundary/tags/market drafts.
  2. Clear successful local drafts.
  3. Fetch fresh readiness from the API.
  4. Publish only when the fresh readiness result is ready.
- A failed publish no longer makes already-saved edits look failed or encourages duplicate writes.
- `PROJECT_NOT_CUSTOMER_READY` responses now preserve `missing[]` and `warnings[]` in the response.
- Every admin request now sends `x-request-id` from the browser to the API.
- API logs now emit `RequestRejected ...` for 4xx responses as well as `RequestFailure ...` for 5xx, so the exact browser Request ID can be searched in Railway application logs.

## Request IDs

Railway access logs have their own platform/edge `requestId`. That is not the Cg Ai application request ID.

After this fix, search Railway **application logs** for:

```text
RequestRejected requestId=<the UUID shown in the browser>
```

The same UUID is sent in `x-request-id` and returned in the API error body.

## Test

1. Open project → النطاق.
2. Search for the compound/road.
3. Choose `Satellite + معالم`.
4. Use `تحريك` to position/zoom.
5. Switch to `تحديد الحدود`.
6. Tap 3+ points; the map must not pan while adding points.
7. Click Save and refresh. Boundary should remain.
8. Click Publish.
9. If readiness is incomplete, the UI must say that edits were saved but publishing was blocked, and list the missing requirements.
10. Copy the Request ID and search API application logs for `RequestRejected requestId=`.
