import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { PRODUCT_LIMITS, stockFilters, type StockFilter } from '@ksm/shared';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';

// Patterns mirror packages/shared/src/inventory.ts (D-013, D-021).
const QUANTITY_PATTERN = /^\d{1,12}(\.\d{1,3})?$/;
const POSITIVE_QUANTITY_PATTERN = /^(?=.*[1-9])\d{1,12}(\.\d{1,3})?$/;
const PRICE_PATTERN = /^\d{1,15}(\.0{1,2})?$/;
const PRICE_MESSAGE = 'Prices are whole shillings, for example 24000';

export class PricesDto {
  /** Whole shillings; null clears the price. Visible only with cost access. */
  @ApiPropertyOptional({ type: String, nullable: true, example: '21600' })
  @IsOptional()
  @IsString()
  @Matches(PRICE_PATTERN, { message: PRICE_MESSAGE })
  buyingPrice?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '24000' })
  @IsOptional()
  @IsString()
  @Matches(PRICE_PATTERN, { message: PRICE_MESSAGE })
  retailPrice?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '23000' })
  @IsOptional()
  @IsString()
  @Matches(PRICE_PATTERN, { message: PRICE_MESSAGE })
  wholesalePrice?: string | null;
}

export class BaseUnitDto extends PricesDto {
  @ApiProperty({ example: 'piece', maxLength: PRODUCT_LIMITS.unitNameMax })
  @IsString()
  @Length(1, PRODUCT_LIMITS.unitNameMax)
  name!: string;

  /** Whether quantities in this unit may have decimals (D-013). */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  allowFraction?: boolean;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: PRODUCT_LIMITS.barcodeMax,
  })
  @IsOptional()
  @IsString()
  @MaxLength(PRODUCT_LIMITS.barcodeMax)
  barcode?: string | null;
}

export class UnitDto extends BaseUnitDto {
  /** Base units in one of this unit (one carton of 12 pieces: "12"). */
  @ApiProperty({ example: '12' })
  @IsString()
  @Matches(POSITIVE_QUANTITY_PATTERN)
  conversion!: string;
}

export class InitialStockDto {
  /** Name of one of the product's units. */
  @ApiProperty({ example: 'carton' })
  @IsString()
  @Length(1, PRODUCT_LIMITS.unitNameMax)
  unitName!: string;

  @ApiProperty({ example: '2' })
  @IsString()
  @Matches(POSITIVE_QUANTITY_PATTERN)
  quantity!: string;

  /** Cost of one of that unit, whole shillings. */
  @ApiPropertyOptional({ type: String, nullable: true, example: '21600' })
  @IsOptional()
  @IsString()
  @Matches(PRICE_PATTERN, { message: PRICE_MESSAGE })
  unitCost?: string | null;
}

export class CreateProductDto {
  @ApiProperty({ maxLength: PRODUCT_LIMITS.nameMax })
  @IsString()
  @Length(1, PRODUCT_LIMITS.nameMax)
  name!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: PRODUCT_LIMITS.skuMax,
  })
  @IsOptional()
  @IsString()
  @MaxLength(PRODUCT_LIMITS.skuMax)
  sku?: string | null;

  /** Low-stock alert at or below this many base units. */
  @ApiPropertyOptional({ type: String, nullable: true, example: '24' })
  @IsOptional()
  @IsString()
  @Matches(QUANTITY_PATTERN)
  reorderLevel?: string | null;

  @ApiProperty({ type: BaseUnitDto })
  @ValidateNested()
  @Type(() => BaseUnitDto)
  baseUnit!: BaseUnitDto;

  @ApiPropertyOptional({ type: [UnitDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PRODUCT_LIMITS.unitsMax - 1)
  @ValidateNested({ each: true })
  @Type(() => UnitDto)
  units?: UnitDto[];

  @ApiPropertyOptional({ type: InitialStockDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => InitialStockDto)
  openingStock?: InitialStockDto | null;
}

export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['baseUnit', 'units', 'openingStock'] as const),
) {}

export class UpdateUnitDto {
  @ApiPropertyOptional({ maxLength: PRODUCT_LIMITS.unitNameMax })
  @IsOptional()
  @IsString()
  @Length(1, PRODUCT_LIMITS.unitNameMax)
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(PRODUCT_LIMITS.barcodeMax)
  barcode?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowFraction?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' || value === true
    ? true
    : value === 'false' || value === false
      ? false
      : value;

export class ListProductsQueryDto {
  /** Part of the name, the SKU, or a barcode. */
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /** true lists archived products instead of active ones. */
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  archived?: boolean;

  @ApiPropertyOptional({ enum: stockFilters })
  @IsOptional()
  @IsIn(stockFilters)
  stock?: StockFilter;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(400)
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: PRODUCT_LIMITS.pageMax })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PRODUCT_LIMITS.pageMax)
  limit?: number;
}

export class CategoryDto {
  @ApiProperty({ maxLength: PRODUCT_LIMITS.categoryNameMax })
  @IsString()
  @Length(1, PRODUCT_LIMITS.categoryNameMax)
  name!: string;
}

export class UpdateCategoryDto extends PartialType(CategoryDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}
