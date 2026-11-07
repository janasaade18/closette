import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class SaveGarmentDto {
  @ApiProperty({
    description: 'Closette profile that owns this wardrobe item',
  })
  @IsUUID()
  profileId!: string;

  @ApiPropertyOptional({
    description: 'Optional K-Means cluster count for color (5–8)',
    minimum: 5,
    maximum: 8,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(8)
  k?: number;
}
