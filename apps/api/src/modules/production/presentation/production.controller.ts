import { Body, ConflictException, Controller, HttpCode, NotFoundException, Param, Post, UnprocessableEntityException } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PostProductionUseCase } from "../application/post-production.use-case";
import { InsufficientProductionInventoryError, InvalidProductionPostingError, ProductionNotFoundError, ProductionPostingConflictError } from "../application/production-posting.errors";
import { PostProductionDto } from "./dto/post-production.dto";
import { RequirePermissions } from "../../authorization/decorators/require-permissions.decorator";
import { Permissions } from "../../authorization/permission.registry";

@ApiTags("productions")
@Controller("productions")
export class ProductionController {
  constructor(private readonly postProductionUseCase: PostProductionUseCase) {}

  @Post(":id/post")
  @RequirePermissions(Permissions.PRODUCTION_POST)
  @HttpCode(200)
  @ApiOperation({ summary: "Post a confirmed Production and apply stock and cost effects" })
  @ApiOkResponse({ description: "The production was posted." })
  async postProduction(@Param("id") id: string, @Body() dto: PostProductionDto) {
    try { return await this.postProductionUseCase.execute(id, dto.actualQuantity); }
    catch (error: unknown) {
      if (error instanceof ProductionNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof ProductionPostingConflictError) throw new ConflictException(error.message);
      if (error instanceof InvalidProductionPostingError || error instanceof InsufficientProductionInventoryError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }
}
