import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  paymentMethods,
  PAYMENT_LIMITS,
  type PaymentMethod,
} from '@ksm/shared';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class SubmitPaymentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  planId!: string;

  @ApiPropertyOptional({ enum: paymentMethods, default: 'manual' })
  @IsOptional()
  @IsIn(paymentMethods)
  method?: PaymentMethod;

  /** The mobile-money transaction id (required for manual payments). */
  @ApiPropertyOptional({
    minLength: PAYMENT_LIMITS.referenceMin,
    maxLength: PAYMENT_LIMITS.referenceMax,
  })
  @IsOptional()
  @IsString()
  @Length(PAYMENT_LIMITS.referenceMin, PAYMENT_LIMITS.referenceMax)
  @Matches(/^\s*[A-Za-z0-9.\-_/]+\s*$/)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\s*\+?[0-9 ]{9,16}\s*$/)
  payerPhone?: string;

  /** A fresh random value per payment attempt; retries reuse it. */
  @ApiProperty({ minLength: 8, maxLength: 80 })
  @IsString()
  @Length(8, 80)
  idempotencyKey!: string;
}

export class PaymentDecisionDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class PaymentListQueryDto {
  @ApiPropertyOptional({ enum: ['attention', 'all'], default: 'attention' })
  @IsOptional()
  @IsIn(['attention', 'all'])
  filter?: 'attention' | 'all';
}
