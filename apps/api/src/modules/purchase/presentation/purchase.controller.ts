import {
  ConflictException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  InvalidPurchaseItemError,
  PurchaseNotFoundError,
  PurchasePostingConflictError,
} from "../application/purchase-posting.errors";
import { PostPurchaseUseCase } from "../application/post-purchase.use-case";
import {
  ConfirmPurchaseUseCase,
  CreatePurchaseDraftUseCase,
  GetPurchaseUseCase,
  UpdatePurchaseDraftUseCase,
} from "../application/purchase-draft.use-cases";
import {
  PurchaseDraftConflictError,
  PurchaseDraftNotFoundError,
  PurchaseDraftValidationError,
} from "../application/purchase-draft.errors";
import { CreatePurchaseDto } from "./dto/create-purchase.dto";
import { UpdatePurchaseDto } from "./dto/update-purchase.dto";

type PostedPurchaseResponse = {
  id: string;
  status: "POSTED";
  postedAt: Date;
};

@ApiTags("purchases")
@Controller("purchases")
export class PurchaseController {
  constructor(
    private readonly postPurchaseUseCase: PostPurchaseUseCase,
    private readonly createPurchaseDraftUseCase: CreatePurchaseDraftUseCase,
    private readonly getPurchaseUseCase: GetPurchaseUseCase,
    private readonly updatePurchaseDraftUseCase: UpdatePurchaseDraftUseCase,
    private readonly confirmPurchaseUseCase: ConfirmPurchaseUseCase,
  ) {}

  @Post()
  @ApiOperation({ summary: "Create a purchase draft" })
  createPurchase(@Body() dto: CreatePurchaseDto) {
    return this.runDraft(() => this.createPurchaseDraftUseCase.execute(dto));
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a purchase" })
  getPurchase(@Param("id") id: string) {
    return this.runDraft(() => this.getPurchaseUseCase.execute(id));
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a purchase draft" })
  updatePurchase(@Param("id") id: string, @Body() dto: UpdatePurchaseDto) {
    return this.runDraft(() => this.updatePurchaseDraftUseCase.execute(id, dto));
  }

  @Post(":id/confirm")
  @ApiOperation({ summary: "Confirm a purchase draft" })
  confirmPurchase(@Param("id") id: string) {
    return this.runDraft(() => this.confirmPurchaseUseCase.execute(id));
  }

  @Post(":id/post")
  @HttpCode(200)
  @ApiOperation({ summary: "Post a purchase and apply its price and inventory effects" })
  @ApiOkResponse({ description: "The purchase was posted." })
  async postPurchase(@Param("id") purchaseId: string): Promise<PostedPurchaseResponse> {
    try {
      return await this.postPurchaseUseCase.execute(purchaseId);
    } catch (error: unknown) {
      if (error instanceof PurchaseNotFoundError) {
        throw new NotFoundException(error.message);
      }

      if (error instanceof PurchasePostingConflictError) {
        throw new ConflictException(error.message);
      }

      if (error instanceof InvalidPurchaseItemError) {
        throw new UnprocessableEntityException(error.message);
      }

      throw error;
    }
  }

  private async runDraft<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error: unknown) {
      if (error instanceof PurchaseDraftNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof PurchaseDraftConflictError) throw new ConflictException(error.message);
      if (error instanceof PurchaseDraftValidationError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }
}
