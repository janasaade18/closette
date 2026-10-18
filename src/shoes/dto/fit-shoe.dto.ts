import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class FitShoeDto {
  @ApiPropertyOptional({
    description:
      'Foot scan id. Used when foot_measurements exist for that scan.',
  })
  @IsOptional()
  @IsUUID()
  scanId?: string;

  @ApiPropertyOptional({
    example: 245,
    description:
      'Manual foot length in mm when a scan measurement is not ready yet (demo / testing).',
  })
  @IsOptional()
  @IsNumber()
  @Min(100)
  lengthMm?: number;

  @ApiPropertyOptional({ example: 90 })
  @IsOptional()
  @IsNumber()
  @Min(40)
  forefootWidthMm?: number;
}
