import { IsString, Matches } from "class-validator";

// This canonical, non-negative Decimal(24,9) string keeps replenishment
// quantities out of JavaScript floating-point arithmetic.
export class CreateReplenishmentPolicyDto {
  @IsString()
  @Matches(/^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,9})?$/)
  reorderPointQuantity!: string;
}
