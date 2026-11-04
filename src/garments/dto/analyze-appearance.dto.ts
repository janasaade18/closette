import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class AnalyzeAppearanceDto {
  @ApiPropertyOptional({
    description:
      'JSON from the garment-type classifier: a list of {type, confidence, box}',
  })
  @IsOptional()
  @IsString()
  classification?: string;

  @ApiPropertyOptional({
    description: 'K-Means cluster count. Must stay in the product range 5–8.',
    minimum: 5,
    maximum: 8,
    default: 6,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(8)
  k?: number;
}
