import "./load-root-env";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import helmet from "helmet";
import cookieParser = require("cookie-parser");
import { json, urlencoded } from "express";
import { randomUUID } from "node:crypto";
import { AppModule } from "./app.module";
import { SafeHttpExceptionFilter } from "./security/http-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:", "blob:"],
          fontSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: [],
        },
      },
    }),
  );
  app.use(cookieParser());
  app.use(json({ limit: "1mb" }), urlencoded({ extended: true, limit: "1mb" }));
  app.use((request: any, response: any, next: () => void) => { request.requestId = request.headers["x-request-id"] || randomUUID(); response.setHeader("x-request-id", request.requestId); next(); });
  app.setGlobalPrefix("v1");
  const origins = (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(",").map(x => x.trim()).filter(Boolean);
  app.enableCors({ origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => !origin || origins.includes(origin) ? callback(null, true) : callback(new Error("Origin not allowed"), false), credentials: true, allowedHeaders: ["content-type", "x-device-token", "x-request-id"], exposedHeaders: ["content-disposition", "x-request-id"], methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, stopAtFirstError: true }));
  app.useGlobalFilters(new SafeHttpExceptionFilter());
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 8080);

  await app.listen(port, "0.0.0.0");

  console.log(`API listening on 0.0.0.0:${port}`);
}

bootstrap();
