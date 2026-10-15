import { ApiProperty } from '@nestjs/swagger';
import { ROLE_LIMITS } from '@ksm/shared';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsUUID,
} from 'class-validator';

export class SetRolesDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(ROLE_LIMITS.maxRolesPerMember)
  @IsUUID('all', { each: true })
  roleIds!: string[];
}

export class SetStatusDto {
  /** REMOVED is done with DELETE. */
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] })
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status!: 'ACTIVE' | 'SUSPENDED';
}

export class SetOwnerDto {
  @ApiProperty()
  @IsBoolean()
  isOwner!: boolean;
}
