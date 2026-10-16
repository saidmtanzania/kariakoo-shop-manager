import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { SessionInfo } from '@ksm/shared';
import type { Response } from 'express';
import { Public, SignedIn } from '../../../common/auth/access.decorators.js';
import {
  Client,
  CurrentAuth,
  type AuthContext,
  type ClientInfo,
} from '../../../common/auth/request-context.js';
import {
  RateLimit,
  RateLimitGuard,
} from '../../../common/rate-limit/rate-limit.guard.js';
import {
  EmailDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  SwitchShopDto,
  TokenDto,
} from '../dto/auth.dto.js';
import { AuthService } from '../services/auth.service.js';
import { SessionService } from '../services/session.service.js';

const ACCEPTED = {
  message:
    'If the details are valid, we have sent an email with the next step.',
};

@ApiTags('auth')
@Controller('auth')
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Post('register')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ name: 'register', limit: 10, windowSeconds: 3600, by: 'ip' })
  async register(@Body() dto: RegisterDto, @Client() client: ClientInfo) {
    await this.auth.register(dto, client);
    return ACCEPTED;
  }

  @Post('verify-email')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ name: 'verify-email', limit: 20, windowSeconds: 3600, by: 'ip' })
  async verifyEmail(
    @Body() dto: TokenDto,
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.auth.verifyEmail(dto.token, client);
  }

  @Post('resend-verification')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(
    { name: 'resend-verification', limit: 10, windowSeconds: 3600, by: 'ip' },
    { name: 'resend-verification', limit: 3, windowSeconds: 3600, by: 'email' },
  )
  async resendVerification(@Body() dto: EmailDto) {
    await this.auth.resendVerification(dto.email);
    return ACCEPTED;
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ name: 'login', limit: 20, windowSeconds: 900, by: 'ip' })
  async login(
    @Body() dto: LoginDto,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const { token } = await this.auth.login(dto, client);
    this.sessions.writeCookie(res, token);
  }

  @Post('logout')
  @SignedIn()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(auth, client);
    this.sessions.clearCookie(res);
  }

  @Post('password/forgot')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(
    { name: 'forgot-password', limit: 10, windowSeconds: 3600, by: 'ip' },
    { name: 'forgot-password', limit: 3, windowSeconds: 3600, by: 'email' },
  )
  async forgotPassword(@Body() dto: EmailDto, @Client() client: ClientInfo) {
    await this.auth.requestPasswordReset(dto.email, client);
    return ACCEPTED;
  }

  @Post('password/reset')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({
    name: 'reset-password',
    limit: 20,
    windowSeconds: 3600,
    by: 'ip',
  })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.auth.resetPassword(dto.token, dto.password, client);
  }

  /** The signed-in user, their shops and the active shop. */
  @Get('session')
  @SignedIn()
  session(@CurrentAuth() auth: AuthContext): Promise<SessionInfo> {
    return this.auth.sessionInfo(auth);
  }

  @Put('session/active-shop')
  @SignedIn()
  @HttpCode(HttpStatus.NO_CONTENT)
  async switchShop(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: SwitchShopDto,
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.auth.switchShop(auth, dto.shopId, client);
  }
}
