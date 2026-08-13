import { Injectable, ServiceUnavailableException } from "@nestjs/common";

@Injectable()
export class MapsService {
  private key() { const key = process.env.GOOGLE_MAPS_SERVER_API_KEY; if (!key) throw new ServiceUnavailableException({ code: "MAPS_NOT_CONFIGURED", message: "Google Maps is not configured", safe: true }); return key; }
  private async request(url: string, init: RequestInit, service: string, timeoutMs = 15_000) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
        if (response.ok) return response.json();
        if (response.status < 500 && response.status !== 429) throw new ServiceUnavailableException({ code: `MAPS_${service.toUpperCase()}_REJECTED`, message: `${service} request was rejected`, upstreamStatus: response.status, safe: true });
        if (attempt) throw new ServiceUnavailableException({ code: `MAPS_${service.toUpperCase()}_UNAVAILABLE`, message: `${service} is temporarily unavailable`, upstreamStatus: response.status, safe: true });
      } catch (error) {
        if (error instanceof ServiceUnavailableException) throw error;
        if (attempt) throw new ServiceUnavailableException({ code: `MAPS_${service.toUpperCase()}_UNAVAILABLE`, message: `${service} is temporarily unavailable`, safe: true });
      }
    }
    throw new ServiceUnavailableException({ code: `MAPS_${service.toUpperCase()}_UNAVAILABLE`, message: `${service} is temporarily unavailable`, safe: true });
  }
  async geocode(address: string) { const body = await this.request(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${encodeURIComponent(this.key())}`, {}, "geocoding", 12_000) as Record<string, unknown>; if (body.status !== "OK" && body.status !== "ZERO_RESULTS") throw new ServiceUnavailableException({ code: "MAPS_GEOCODING_REJECTED", message: "Geocoding request was rejected", safe: true }); return body; }
  places(query: string) { return this.request("https://places.googleapis.com/v1/places:searchText", { method: "POST", headers: { "content-type": "application/json", "X-Goog-Api-Key": this.key(), "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location" }, body: JSON.stringify({ textQuery: query, regionCode: "EG" }) }, "places", 12_000); }
  route(origin: string, destination: string) { return this.request("https://routes.googleapis.com/directions/v2:computeRoutes", { method: "POST", headers: { "content-type": "application/json", "X-Goog-Api-Key": this.key(), "X-Goog-FieldMask": "routes.distanceMeters,routes.duration" }, body: JSON.stringify({ origin: { address: origin }, destination: { address: destination }, travelMode: "DRIVE" }) }, "routes", 18_000); }
}
