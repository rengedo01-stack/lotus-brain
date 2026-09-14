import { IsDateString } from "class-validator";

export class CreateRecommendationPurchaseDraftDto {
  @IsDateString()
  purchaseDate!: string;
}
