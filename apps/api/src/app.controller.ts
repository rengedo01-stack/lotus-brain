import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

type HealthCheck = {
  status: "ok";
};

@ApiTags("health")
@Controller("health")
export class AppController {
  @Get()
  @ApiOperation({ summary: "Check API availability" })
  @ApiOkResponse({ description: "The API is available." })
  getHealth(): HealthCheck {
    return { status: "ok" };
  }
}
