import { ApiProperty } from '@nestjs/swagger';
import { ROLE_LIMITS } from '@ksm/shared';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';

export class CreateInvitationDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @ArrayMaxSize(ROLE_LIMITS.maxRolesPerMember)
  @IsUUID('all', { each: true })
  roleIds!: string[];
}

export class InvitationTokenDto {
  @ApiProperty()
  @IsString()
  @Length(20, 200)
  token!: string;
}
