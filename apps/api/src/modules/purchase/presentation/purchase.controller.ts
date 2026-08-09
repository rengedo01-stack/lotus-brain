import {
  ConflictException,
  Controller,
  HttpCode,
  NotFoundException,
  Param,
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

type PostedPurchaseResponse = {
  id: string;
  status: "POSTED";
  postedAt: Date;
};

@ApiTags("purchases")
@Controller("purchases")
export class PurchaseController {
  constructor(private readonly postPurchaseUseCase: PostPurchaseUseCase) {}

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
}
