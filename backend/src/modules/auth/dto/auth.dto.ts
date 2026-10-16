import { ApiProperty } from '@nestjs/swagger';
import { AUTH_LIMITS } from '@ksm/shared';
import { IsEmail, IsString, IsUUID, Length, MaxLength } from 'class-validator';

// Limits come from @ksm/shared so the API and the web forms agree.

export class RegisterDto {
  @ApiProperty({ maxLength: AUTH_LIMITS.nameMax })
  @IsString()
  @Length(1, AUTH_LIMITS.nameMax)
  fullName!: string;

  @ApiProperty({ format: 'email' })
  @IsEmail()
  @MaxLength(AUTH_LIMITS.emailMax)
  email!: string;

  @ApiProperty({
    minLength: AUTH_LIMITS.passwordMin,
    maxLength: AUTH_LIMITS.passwordMax,
  })
  @IsString()
  @Length(AUTH_LIMITS.passwordMin, AUTH_LIMITS.passwordMax)
  password!: string;
}

export class LoginDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  @MaxLength(AUTH_LIMITS.emailMax)
  email!: string;

  @ApiProperty()
  @IsString()
  @Length(1, AUTH_LIMITS.passwordMax)
  password!: string;
}

export class EmailDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  @MaxLength(AUTH_LIMITS.emailMax)
  email!: string;
}

export class TokenDto {
  @ApiProperty()
  @IsString()
  @Length(20, 200)
  token!: string;
}

export class ResetPasswordDto extends TokenDto {
  @ApiProperty({
    minLength: AUTH_LIMITS.passwordMin,
    maxLength: AUTH_LIMITS.passwordMax,
  })
  @IsString()
  @Length(AUTH_LIMITS.passwordMin, AUTH_LIMITS.passwordMax)
  password!: string;
}

export class SwitchShopDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  shopId!: string;
}
