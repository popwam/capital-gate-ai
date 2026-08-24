import "./load-root-env";
import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json, urlencoded } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { AutomationExceptionFilter } from "./common/automation-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(helmet());
  app.use(json({ limit: "256kb" }), urlencoded({ extended: true, limit: "256kb" }));
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    stopAtFirstError: true,
  }));
  app.useGlobalFilters(new AutomationExceptionFilter());
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 8081);
  await app.listen(port, "0.0.0.0");
  console.log(`Nadim automation API listening on 0.0.0.0:${port}`);
}

bootstrap();
