import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
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
  login(@Body() dto: LoginDto, @ClientIp() ip: string) {
    return this.auth.login(dto.username, dto.password, ip);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refresh_token);
  }

  @ApiBearerAuth()
  @Get('perfil')
  perfil(@CurrentUser() u: UsuarioActual) {
    return this.auth.perfil(u.id);
  }

  @ApiBearerAuth()
  @Patch('password')
  cambiarPassword(
    @CurrentUser() u: UsuarioActual,
    @Body() dto: CambiarPasswordDto,
    @ClientIp() ip: string,
  ) {
    return this.auth.cambiarPassword(u.id, dto.actual, dto.nueva, ip);
  }

  @ApiBearerAuth()
  @Patch('tema')
  tema(@CurrentUser() u: UsuarioActual, @Body() dto: TemaDto) {
    return this.auth.cambiarTema(u.id, dto.tema);
  }
}
