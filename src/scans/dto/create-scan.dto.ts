import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export enum FootSide {
  Left = 'left',
  Right = 'right',
}

export class DeviceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  os?: string;
}

export class CameraIntrinsicsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  fx?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  fy?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  cx?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  cy?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  width?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  height?: number;
}

export class ScaleReferenceDto {
  @ApiPropertyOptional({ example: 'calibration_mat' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ example: 200 })
  @IsOptional()
  @IsNumber()
  markerDistanceMm?: number;
}

export class CreateScanDto {
  @ApiProperty({
    enum: FootSide,
    example: FootSide.Left,
    description: 'Scan one foot at a time. Start with the left foot.',
  })
  @IsEnum(FootSide)
  footSide!: FootSide;

  @ApiPropertyOptional({ type: DeviceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceDto)
  @IsObject()
  device?: DeviceDto;

  @ApiPropertyOptional({ type: CameraIntrinsicsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CameraIntrinsicsDto)
  @IsObject()
  cameraIntrinsics?: CameraIntrinsicsDto;

  @ApiPropertyOptional({ type: ScaleReferenceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ScaleReferenceDto)
  @IsObject()
  scaleReference?: ScaleReferenceDto;
}
