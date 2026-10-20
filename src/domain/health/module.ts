import { Module } from "@nestjs/common";
import { HealthController } from "./controller.js";

@Module({ controllers: [HealthController] })
export class HealthModule {}
