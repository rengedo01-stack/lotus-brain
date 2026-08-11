import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "./modules/auth/decorators/public.decorator";

type HealthCheck = {
  status: "ok";
};

@ApiTags("health")
@Controller("health")
export class AppController {
  @Public()
  @Get()
  @ApiOperation({ summary: "Check API availability" })
  @ApiOkResponse({ description: "The API is available." })
  getHealth(): HealthCheck {
    return { status: "ok" };
  }
}
