import {
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { AppearanceService } from './appearance.service';
import { AnalyzeAppearanceDto } from './dto/analyze-appearance.dto';
import { SaveGarmentDto } from './dto/save-garment.dto';
import { GarmentsService } from './garments.service';
import { LightingService } from './lighting.service';
import { SaveGarmentService } from './save.service';

@ApiTags('garments')
@Controller('garments')
export class GarmentsController {
  constructor(
    private readonly garmentsService: GarmentsService,
    private readonly appearanceService: AppearanceService,
    private readonly lightingService: LightingService,
    private readonly saveGarmentService: SaveGarmentService,
  ) {}

  @Get('taxonomy')
  @ApiOperation({
    summary: 'Garment type groups the classifier can return',
  })
  @ApiOkResponse({
    description: 'Group and type list shared with the training pipeline',
  })
  getTaxonomy() {
    return this.garmentsService.getTaxonomy();
  }

  @Post('lighting-check')
  @ApiOperation({
    summary: 'Score lighting for a wardrobe photo',
    description:
      'Returns ok, issues, and guidance. The phone should show a red border when ok is false. Bad lighting blocks save.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOkResponse({ description: 'ok, score, issues, guidance, metrics' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 12 * 1024 * 1024 },
    }),
  )
  lightingCheck(@UploadedFile() file: Express.Multer.File) {
    return this.lightingService.check(file);
  }

  @Post('appearance')
  @ApiOperation({
    summary:
      'Type, color, pattern, and texture for the primary garment in one photo',
    description:
      'Names the garment with the type model and attaches color, pattern, and texture on its box. Send classification to reuse boxes. A pattern or texture score under 0.55 comes back as unknown.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        classification: {
          type: 'string',
          description: 'JSON list of {type, confidence, box}',
        },
        k: { type: 'integer', minimum: 5, maximum: 8 },
      },
    },
  })
  @ApiOkResponse({
    description:
      'status, garments (type, color, pattern, texture), model_version',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 12 * 1024 * 1024 },
    }),
  )
  analyzeAppearance(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: AnalyzeAppearanceDto,
  ) {
    return this.appearanceService.analyze(file, dto);
  }

  @Post('save')
  @ApiOperation({
    summary: 'Save a cutout garment after a lighting check',
    description:
      'Rejects bad lighting. On success, classifies the primary garment, removes the background with SegFormer, uploads the RGBA cutout, and inserts a garments row.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'profileId'],
      properties: {
        file: { type: 'string', format: 'binary' },
        profileId: { type: 'string', format: 'uuid' },
        k: { type: 'string' },
      },
    },
  })
  @ApiOkResponse({ description: 'status saved, garment row, lighting' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 12 * 1024 * 1024 },
    }),
  )
  saveGarment(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: SaveGarmentDto,
  ) {
    return this.saveGarmentService.save(file, dto);
  }
}
