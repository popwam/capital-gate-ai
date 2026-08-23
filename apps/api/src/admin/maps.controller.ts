import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AdminAuthGuard } from "../auth/admin-auth.guard";
import { MapsService } from "../maps.service";

@UseGuards(AdminAuthGuard)
@Throttle({ default: { limit: 5, ttl: 60_000 } })
@Controller("admin/maps")
export class MapsController {
  constructor(private readonly maps: MapsService) {}
  @Get("geocode") geocode(@Query("address") address: string) { return this.maps.geocode(address); }
  @Get("places") places(@Query("query") query: string) { return this.maps.places(query); }
  @Get("route") route(@Query("origin") origin: string, @Query("destination") destination: string) { return this.maps.route(origin, destination); }
}
