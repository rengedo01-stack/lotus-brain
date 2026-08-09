import { Controller, Get } from "@nestjs/common";

type HealthCheck = {
  status: "ok";
};

@Controller("health")
export class AppController {
  @Get()
  getHealth(): HealthCheck {
    return { status: "ok" };
  }
}
