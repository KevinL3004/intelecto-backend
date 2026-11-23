import { EsId, Opcional } from '../../../common/validation/entrada';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Rol } from '../../../common/roles';
import { CrearPersonaDto } from '../../personas/dto/persona.dto';
import { PasswordSegura } from '../../../common/utils/password';

export class CrearUsuarioDto {
  @ApiPropertyOptional({ description: 'Persona existente' })
  @IsOptional()
  @EsId()
  personaId?: number;
  @ApiPropertyOptional({ type: CrearPersonaDto, description: 'O datos para crear la persona' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CrearPersonaDto)
  persona?: CrearPersonaDto;
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-z0-9._]+$/, { message: 'Usuario: solo minúsculas, números, punto y guion bajo' })
  username: string;
  @ApiProperty({ description: 'Contraseña temporal' })
  @PasswordSegura()
  password: string;
  @ApiProperty({ enum: Rol }) @IsEnum(Rol) rol: Rol;
  @ApiPropertyOptional() @IsOptional() @EsId() colegioId?: number | null;
}

export class EditarUsuarioDto {
  @ApiPropertyOptional({ enum: Rol }) @Opcional() @IsEnum(Rol) rol?: Rol;
  @ApiPropertyOptional() @IsOptional() @EsId() colegioId?: number | null;
  @ApiPropertyOptional() @Opcional() @IsBoolean() activo?: boolean;
}

export class ResetPasswordDto {
  @ApiProperty() @PasswordSegura() password: string;
}
