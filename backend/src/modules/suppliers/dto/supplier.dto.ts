import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PURCHASE_LIMITS,
  supplierPaymentMethods,
  type SupplierPaymentMethod,
} from '@ksm/shared';
import { Transform, Type } from 'class-transformer';
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
  MinLength,
} from 'class-validator';

// Patterns mirror packages/shared/src/purchases.ts (D-021: whole shillings).
export const AMOUNT_PATTERN = /^\d{1,15}(\.0{1,2})?$/;
export const POSITIVE_AMOUNT_PATTERN = /^(?=.*[1-9])\d{1,15}(\.0{1,2})?$/;

const toBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true'
    ? true
    : value === false || value === 'false'
      ? false
      : value;

export class CreateSupplierDto {
  @ApiProperty({ maxLength: PURCHASE_LIMITS.supplierNameMax })
  @IsString()
  @Matches(/\S/)
  @MaxLength(PURCHASE_LIMITS.supplierNameMax)
  name!: string;

  @ApiPropertyOptional({ maxLength: PURCHASE_LIMITS.phoneMax })
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_LIMITS.phoneMax)
  phone?: string | null;

  @ApiPropertyOptional({ maxLength: PURCHASE_LIMITS.addressMax })
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_LIMITS.addressMax)
  address?: string | null;

  @ApiPropertyOptional({ maxLength: PURCHASE_LIMITS.noteMax })
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_LIMITS.noteMax)
  note?: string | null;

  /** What the shop already owes this supplier, whole shillings. */
  @ApiPropertyOptional({ example: '150000' })
  @IsOptional()
  @IsString()
  @Matches(AMOUNT_PATTERN)
  openingBalance?: string | null;
}

export class UpdateSupplierDto {
  @ApiPropertyOptional({ maxLength: PURCHASE_LIMITS.supplierNameMax })
  @IsOptional()
  @IsString()
  @Matches(/\S/)
  @MaxLength(PURCHASE_LIMITS.supplierNameMax)
  name?: string;

  @ApiPropertyOptional({ maxLength: PURCHASE_LIMITS.phoneMax })
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_LIMITS.phoneMax)
  phone?: string | null;

  @ApiPropertyOptional({ maxLength: PURCHASE_LIMITS.addressMax })
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_LIMITS.addressMax)
  address?: string | null;

  @ApiPropertyOptional({ maxLength: PURCHASE_LIMITS.noteMax })
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_LIMITS.noteMax)
  note?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class ListSuppliersQueryDto {
  /** Part of the name or phone number. */
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  archived?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(400)
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: PURCHASE_LIMITS.pageMax })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PURCHASE_LIMITS.pageMax)
  limit?: number;
}

export class LedgerQueryDto {
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

export class SupplierPaymentDto {
  /** Whole shillings, more than zero. */
  @ApiProperty({ example: '50000' })
  @IsString()
  @Matches(POSITIVE_AMOUNT_PATTERN)
  amount!: string;

  @ApiProperty({ enum: supplierPaymentMethods })
  @IsIn(supplierPaymentMethods)
  method!: SupplierPaymentMethod;

  /** Mobile-money or bank transaction reference. */
  @ApiPropertyOptional({ maxLength: PURCHASE_LIMITS.referenceMax })
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_LIMITS.referenceMax)
  reference?: string | null;

  @ApiPropertyOptional({ maxLength: PURCHASE_LIMITS.noteMax })
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_LIMITS.noteMax)
  note?: string | null;
}

export class RecordSupplierPaymentDto extends SupplierPaymentDto {
  @ApiProperty({ minLength: 8, maxLength: 80 })
  @IsString()
  @Length(8, 80)
  idempotencyKey!: string;
}

export class ReasonDto {
  @ApiProperty({ minLength: 3, maxLength: PURCHASE_LIMITS.noteMax })
  @IsString()
  @Matches(/\S/)
  @MinLength(3)
  @MaxLength(PURCHASE_LIMITS.noteMax)
  reason!: string;
}
