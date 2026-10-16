import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  adjustmentKinds,
  adjustmentReasons,
  PRODUCT_LIMITS,
  type AdjustmentKind,
  type AdjustmentReason,
} from '@ksm/shared';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// Patterns mirror packages/shared/src/inventory.ts (D-013, D-021).
export const QUANTITY_PATTERN = /^\d{1,12}(\.\d{1,3})?$/;
export const POSITIVE_QUANTITY_PATTERN = /^(?=.*[1-9])\d{1,12}(\.\d{1,3})?$/;
export const PRICE_PATTERN = /^\d{1,15}(\.0{1,2})?$/;

export class AdjustmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  unitId!: string;

  @ApiProperty({ enum: adjustmentKinds })
  @IsIn(adjustmentKinds)
  kind!: AdjustmentKind;

  /** Up to 3 decimals; whole numbers unless the unit allows fractions. */
  @ApiProperty({ example: '2' })
  @IsString()
  @Matches(QUANTITY_PATTERN)
  quantity!: string;

  @ApiProperty({ enum: adjustmentReasons })
  @IsIn(adjustmentReasons)
  reason!: AdjustmentReason;

  @ApiPropertyOptional({ maxLength: PRODUCT_LIMITS.noteMax })
  @IsOptional()
  @IsString()
  @MaxLength(PRODUCT_LIMITS.noteMax)
  note?: string | null;

  /** Cost of one of the unit for stock added, whole shillings. */
  @ApiPropertyOptional({ example: '21600' })
  @IsOptional()
  @IsString()
  @Matches(PRICE_PATTERN)
  unitCost?: string | null;

  @ApiProperty({ minLength: 8, maxLength: 80 })
  @IsString()
  @Length(8, 80)
  idempotencyKey!: string;
}

export class OpeningStockDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  unitId!: string;

  @ApiProperty({ example: '24' })
  @IsString()
  @Matches(POSITIVE_QUANTITY_PATTERN)
  quantity!: string;

  @ApiPropertyOptional({ example: '21600' })
  @IsOptional()
  @IsString()
  @Matches(PRICE_PATTERN)
  unitCost?: string | null;
}

export class MovementsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: PRODUCT_LIMITS.pageMax })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PRODUCT_LIMITS.pageMax)
  limit?: number;
}

export class InventorySettingsDto {
  @ApiProperty()
  @IsBoolean()
  allowNegativeStock!: boolean;
}
