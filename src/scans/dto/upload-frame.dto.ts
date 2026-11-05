import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { FOOT_CAPTURE_VIEWS } from '../constants/capture-guides';
import type { FootCaptureView } from '../constants/capture-guides';

export class CameraPoseDto {
  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  rotation?: number[];

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  translation?: number[];
}

const toBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true';

const toJson = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

export class UploadFrameDto {
  @ApiProperty({ enum: FOOT_CAPTURE_VIEWS, example: 'top' })
  @IsIn(FOOT_CAPTURE_VIEWS)
  view!: FootCaptureView;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  capturedAt?: string;

  @ApiPropertyOptional({
    description: 'Laplacian variance or similar sharpness score',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sharpness?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  footVisible?: boolean;

  @ApiPropertyOptional({
    description: 'Fraction of the frame occupied by the foot (0-1)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  footAreaRatio?: number;

  @ApiPropertyOptional({
    description: 'False if the phone already rejected this frame',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  accepted?: boolean;

  @ApiPropertyOptional({ type: CameraPoseDto })
  @IsOptional()
  @Transform(toJson)
  @ValidateNested()
  @Type(() => CameraPoseDto)
  @IsObject()
  pose?: CameraPoseDto;
}
