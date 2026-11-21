import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { PasswordSegura } from '../../../common/utils/password';

export class LoginDto {
  @ApiProperty({ example: 'admin' }) @IsString() @IsNotEmpty() @MaxLength(50) username: string;
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}

export class RefreshDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) refresh_token: string;
}

export class CambiarPasswordDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(128) actual: string;
  @ApiProperty({
    description: '12+ caracteres, mayúscula, minúscula y número; sin palabras comunes',
  })
  @IsString()
  @PasswordSegura()
  nueva: string;
}

export class TemaDto {
  @ApiProperty({ enum: ['light', 'dark', 'system'] })
  @IsIn(['light', 'dark', 'system'])
  tema: 'light' | 'dark' | 'system';
}
