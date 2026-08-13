import { Controller, Get, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { StorageService } from "./storage.service";

@Controller("storage")
export class StorageController {
  constructor(private readonly storage: StorageService) {}
  @Get(":folder/:file") async local(@Param("folder") folder: string, @Param("file") file: string, @Res() response: Response) { if (process.env.NODE_ENV === "production") return response.status(404).end(); const data = await this.storage.get(`${folder}/${file}`); response.setHeader("Cache-Control", "public, max-age=3600"); response.send(data); }
}
