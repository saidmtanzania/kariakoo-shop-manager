import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PURCHASE_LIMITS,
  purchaseStatuses,
  supplierPaymentMethods,
  type PurchaseStatus,
  type SupplierPaymentMethod,
} from '@ksm/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  MinLength,
  ValidateNested,
} from 'class-validator';

// Patterns mirror packages/shared (D-013 quantities, D-021 whole shillings).
const POSITIVE_QUANTITY_PATTERN = /^(?=.*[1-9])\d{1,12}(\.\d{1,3})?$/;
const PRICE_PATTERN = /^\d{1,15}(\.0{1,2})?$/;
const POSITIVE_AMOUNT_PATTERN = /^(?=.*[1-9])\d{1,15}(\.0{1,2})?$/;

export class PurchaseLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  unitId!: string;

  /** In the unit; whole numbers unless the unit allows fractions (D-013). */
  @ApiProperty({ example: '2' })
  @IsString()
  @Matches(POSITIVE_QUANTITY_PATTERN)
  quantity!: string;

  /** Cost of one of the unit, whole shillings (D-021). */
  @ApiProperty({ example: '21600' })
  @IsString()
  @Matches(PRICE_PATTERN)
  unitCost!: string;
}

export class PurchaseChargeDto {
  @ApiProperty({ maxLength: PURCHASE_LIMITS.chargeDescriptionMax })
  @IsString()
  @Matches(/\S/)
  @MaxLength(PURCHASE_LIMITS.chargeDescriptionMax)
  description!: string;

  @ApiProperty({ example: '1200' })
  @IsString()
  @Matches(POSITIVE_AMOUNT_PATTERN)
  amount!: string;
}

export class PurchaseBodyDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  supplierId!: string;

  /** The supplier's invoice or delivery note number. */
  @ApiPropertyOptional({ maxLength: PURCHASE_LIMITS.referenceMax })
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_LIMITS.referenceMax)
  supplierReference?: string | null;

  @ApiPropertyOptional({ maxLength: PURCHASE_LIMITS.noteMax })
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_LIMITS.noteMax)
  note?: string | null;

  @ApiProperty({ type: [PurchaseLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PURCHASE_LIMITS.linesMax)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  lines!: PurchaseLineDto[];

  /** Extra costs such as transport and porters (D-015). */
  @ApiProperty({ type: [PurchaseChargeDto] })
  @IsArray()
  @ArrayMaxSize(PURCHASE_LIMITS.chargesMax)
  @ValidateNested({ each: true })
  @Type(() => PurchaseChargeDto)
  charges!: PurchaseChargeDto[];
}

export class CreatePurchaseDto extends PurchaseBodyDto {
  @ApiProperty({ minLength: 8, maxLength: 80 })
  @IsString()
  @Length(8, 80)
  idempotencyKey!: string;
}

export class PurchasePaymentDto {
  /** Whole shillings, more than zero. */
  @ApiProperty({ example: '20000' })
  @IsString()
  @Matches(POSITIVE_AMOUNT_PATTERN)
  amount!: string;

  @ApiProperty({ enum: supplierPaymentMethods })
  @IsIn(supplierPaymentMethods)
  method!: SupplierPaymentMethod;

  @ApiPropertyOptional({ maxLength: PURCHASE_LIMITS.referenceMax })
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_LIMITS.referenceMax)
  reference?: string | null;
}

export class CancelPurchaseDto {
  @ApiProperty({ minLength: 3, maxLength: PURCHASE_LIMITS.noteMax })
  @IsString()
  @Matches(/\S/)
  @MinLength(3)
  @MaxLength(PURCHASE_LIMITS.noteMax)
  reason!: string;
}

export class ReceivePurchaseDto {
  /** Paid to the supplier now, as the goods are received (optional). */
  @ApiPropertyOptional({ type: PurchasePaymentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PurchasePaymentDto)
  payment?: PurchasePaymentDto | null;
}

export class ListPurchasesQueryDto {
  @ApiPropertyOptional({ enum: purchaseStatuses })
  @IsOptional()
  @IsIn(purchaseStatuses)
  status?: PurchaseStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: PURCHASE_LIMITS.pageMax })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PURCHASE_LIMITS.pageMax)
  limit?: number;
}
