import { ApiProperty } from '@nestjs/swagger';
import {
  ROLE_LIMITS,
  SHOP_PERMISSIONS,
  type ShopPermissionCode,
} from '@ksm/shared';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsString,
  Length,
} from 'class-validator';

export class RoleDto {
  @ApiProperty({ maxLength: ROLE_LIMITS.nameMax })
  @IsString()
  @Length(1, ROLE_LIMITS.nameMax)
  name!: string;

  /** Platform permissions are not in this list, so they are rejected here. */
  @ApiProperty({ enum: SHOP_PERMISSIONS, isArray: true })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(SHOP_PERMISSIONS.length)
  @IsIn(SHOP_PERMISSIONS, { each: true })
  permissions!: ShopPermissionCode[];
}
