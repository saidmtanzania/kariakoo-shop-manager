import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
  OmitType,
} from '@nestjs/swagger';
import {
  FEATURE_KEYS,
  PLAN_FEATURES,
  PLAN_LIMITS,
  planIntervals,
  type FeatureKey,
  type PlanInterval,
} from '@ksm/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PlanFeatureDto {
  @ApiProperty({ enum: FEATURE_KEYS })
  @IsIn(FEATURE_KEYS)
  featureKey!: FeatureKey;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  /** For limit features: null means unlimited. */
  @ApiProperty({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PLAN_LIMITS.featureLimitMax)
  limitValue!: number | null;
}

export class CreatePlanDto {
  @ApiProperty({ example: 'monthly-standard' })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{1,39}$/)
  code!: string;

  @ApiProperty({ maxLength: PLAN_LIMITS.nameMax })
  @IsString()
  @Length(1, PLAN_LIMITS.nameMax)
  name!: string;

  @ApiProperty({ enum: planIntervals })
  @IsIn(planIntervals)
  interval!: PlanInterval;

  /** Decimal string, at most 2 decimal places (decision A-008). */
  @ApiProperty({ example: '25000.00' })
  @IsString()
  @Matches(/^\d{1,16}(\.\d{1,2})?$/)
  price!: string;

  @ApiPropertyOptional({ default: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PLAN_LIMITS.graceDaysMax)
  graceDays?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;

  @ApiProperty({ type: [PlanFeatureDto] })
  @IsArray()
  @ArrayMaxSize(PLAN_FEATURES.length)
  @ValidateNested({ each: true })
  @Type(() => PlanFeatureDto)
  features!: PlanFeatureDto[];
}

/** Code and interval cannot change once a plan exists. */
export class UpdatePlanDto extends PartialType(
  OmitType(CreatePlanDto, ['code', 'interval'] as const),
) {}

export class BillingSettingsDto {
  @ApiProperty({ minimum: 0, maximum: 90 })
  @IsInt()
  @Min(0)
  @Max(90)
  trialDays!: number;

  @ApiProperty({ minimum: 0, maximum: 30 })
  @IsInt()
  @Min(0)
  @Max(30)
  reminderDaysBefore!: number;

  @ApiProperty({ type: String, nullable: true, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  paymentInstructions!: string | null;
}
