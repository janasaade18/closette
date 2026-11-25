import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class MuseChatHistoryItemDto {
  @ApiProperty({ enum: ['user', 'assistant', 'muse'] })
  @IsIn(['user', 'assistant', 'muse'])
  role!: 'user' | 'assistant' | 'muse';

  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  content!: string;
}

export class MuseChatDto {
  @ApiProperty({ description: 'Closette user / profile id' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  userId!: string;

  @ApiProperty({ description: 'Latest user message' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;

  @ApiProperty({ type: [MuseChatHistoryItemDto] })
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => MuseChatHistoryItemDto)
  history!: MuseChatHistoryItemDto[];

  @ApiPropertyOptional({
    description: 'Wardrobe garments mapped to Muse garment shape',
  })
  @IsOptional()
  @IsArray()
  wardrobe?: Record<string, unknown>[];

  @ApiPropertyOptional({ description: 'Muse profile preference fields' })
  @IsOptional()
  @IsObject()
  profile?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Shared session context (occasion, weather, last outfit ids)',
  })
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Marketplace products for Muse gap-fill when the agent enables marketplace',
  })
  @IsOptional()
  @IsArray()
  marketplaceProducts?: Record<string, unknown>[];

  @ApiPropertyOptional({
    description: 'User location string for weather tool (e.g. from profile)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @ApiPropertyOptional({ description: 'Optional latitude for live weather' })
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({ description: 'Optional longitude for live weather' })
  @IsOptional()
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional({
    description: 'Durable Muse memory summary for this user',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  memorySummary?: string;

  @ApiPropertyOptional({
    description: 'Durable Muse memory facts (likes, fit notes, etc.)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  memoryFacts?: string[];
}
