import { Body, Controller, Get, Headers, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ClientIp, CurrentUser, Public, UsuarioActual } from '../../common/decorators';
import { AuthService } from './auth.service';
import { CambiarPasswordDto, LoginDto, RefreshDto, TemaDto } from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @ClientIp() ip: string, @Headers('user-agent') ua?: string) {
    return this.auth.login(dto.username, dto.password, ip, ua ?? '');
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto, @ClientIp() ip: string) {
    return this.auth.refresh(dto.refresh_token, ip);
  }

  /** Cierra la sesión actual en el servidor (el refresh token deja de servir). */
  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(200)
  logout(@CurrentUser() u: UsuarioActual, @ClientIp() ip: string) {
    return this.auth.logout(u.id, u.sesionId, ip);
  }

  @ApiBearerAuth()
  @Get('perfil')
  perfil(@CurrentUser() u: UsuarioActual) {
    return this.auth.perfil(u.id);
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Patch('password')
  cambiarPassword(
    @CurrentUser() u: UsuarioActual,
    @Body() dto: CambiarPasswordDto,
    @ClientIp() ip: string,
  ) {
    return this.auth.cambiarPassword(u.id, u.sesionId, dto.actual, dto.nueva, ip);
  }

  @ApiBearerAuth()
  @Patch('tema')
  tema(@CurrentUser() u: UsuarioActual, @Body() dto: TemaDto) {
    return this.auth.cambiarTema(u.id, dto.tema);
  }
}
