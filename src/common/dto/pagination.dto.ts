import { Opcional } from '../validation/entrada';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class PaginationDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 20;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @Opcional() @IsIn(['true', 'false']) activo?: 'true' | 'false';
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export const paginate = <T>(data: T[], total: number, p: PaginationDto): Paginated<T> => ({
  data,
  total,
  page: p.page,
  limit: p.limit,
});
