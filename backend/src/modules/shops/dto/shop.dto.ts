import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { businessTypes, type BusinessType } from '@ksm/shared';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

// Limits mirror createShopSchema in @ksm/shared.

export class CreateShopDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiPropertyOptional({ maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional({ enum: businessTypes, default: 'BOTH' })
  @IsOptional()
  @IsIn(businessTypes)
  businessType?: BusinessType;
}

/** Shop status, timezone and currency are not editable by the owner here. */
export class UpdateShopDto extends PartialType(CreateShopDto) {}
