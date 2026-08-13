import { Injectable, ServiceUnavailableException } from "@nestjs/common";

@Injectable()
export class MapsService {
  private key() { const key = process.env.GOOGLE_MAPS_SERVER_API_KEY; if (!key) throw new ServiceUnavailableException("Google Maps is not configured"); return key; }
  async geocode(address: string) { const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${encodeURIComponent(this.key())}`, { signal: AbortSignal.timeout(10_000) }); if (!response.ok) throw new ServiceUnavailableException("Google Maps request failed"); return response.json(); }
  async places(query: string) { const response = await fetch("https://places.googleapis.com/v1/places:searchText", { method: "POST", headers: { "content-type": "application/json", "X-Goog-Api-Key": this.key(), "X-Go-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location" }, body: JSON.stringify({ textQuery: query, regionCode: "EG" }), signal: AbortSignal.timeout(10_000) }); if (!response.ok) throw new ServiceUnavailableException("Google Places request failed"); return response.json(); }
  async route(origin: string, destination: string) { const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", { method: "POST", headers: { "content-type": "application/json", "X-Goog-Api-Key": this.key(), "X-Goog-FieldMask": "routes.distanceMeters,routes.duration" }, body: JSON.stringify({ origin: { address: origin }, destination: { address: destination }, travelMode: "DRIVE" }), signal: AbortSignal.timeout(15_000) }); if (!response.ok) throw new ServiceUnavailableException("Google Routes request failed"); return response.json(); }
}
