import { IsNotEmpty, IsString, Matches } from "class-validator";

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export class PostProductionDto {
  @IsString()
  @IsNotEmpty()
  @Matches(DECIMAL)
  actualQuantity!: string;
}
