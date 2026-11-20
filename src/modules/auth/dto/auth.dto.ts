import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
export const PASSWORD_MSG =
  'La contraseña debe tener al menos 8 caracteres, mayúscula, minúscula y número';

export class LoginDto {
  @ApiProperty({ example: 'admin' }) @IsString() @IsNotEmpty() @MaxLength(50) username: string;
  @ApiProperty({ example: 'Intelecto2026!' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  password: string;
}

export class RefreshDto {
  @ApiProperty() @IsString() @IsNotEmpty() refresh_token: string;
}

export class CambiarPasswordDto {
  @ApiProperty() @IsString() @IsNotEmpty() actual: string;
  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(PASSWORD_REGEX, { message: PASSWORD_MSG })
  nueva: string;
}

export class TemaDto {
  @ApiProperty({ enum: ['light', 'dark', 'system'] })
  @IsIn(['light', 'dark', 'system'])
  tema: 'light' | 'dark' | 'system';
}
