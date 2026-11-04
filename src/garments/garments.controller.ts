import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { AppearanceService } from './appearance.service';
import { ClassifyService } from './classify.service';
import { AnalyzeAppearanceDto } from './dto/analyze-appearance.dto';
import { GarmentsService } from './garments.service';

@ApiTags('garments')
@Controller('garments')
export class GarmentsController {
  constructor(
    private readonly garmentsService: GarmentsService,
    private readonly appearanceService: AppearanceService,
    private readonly classifyService: ClassifyService,
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

  @Post('classify')
  @ApiOperation({
    summary: 'Name the primary garment in one photo',
    description:
      'Proxies to the Python garment-type service (FashionCLIP + SegFormer). Returns category, subcategory, confidence, optional bbox, and review status.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiQuery({ name: 'include_mask', required: false, type: Boolean })
  @ApiQuery({ name: 'include_embedding', required: false, type: Boolean })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOkResponse({
    description: 'Classify contract from ml/garment/docs/CONTRACT.md',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 12 * 1024 * 1024 },
    }),
  )
  classify(
    @UploadedFile() file: Express.Multer.File,
    @Query('include_mask') includeMask?: string,
    @Query('include_embedding') includeEmbedding?: string,
  ) {
    return this.classifyService.classify(file, {
      include_mask: includeMask,
      include_embedding: includeEmbedding,
    });
  }

  @Post('corrections')
  @ApiOperation({
    summary: 'Store a user correction for a garment prediction',
  })
  @ApiOkResponse({ description: 'Correction accepted for later review' })
  corrections(@Body() body: Record<string, unknown>) {
    return this.classifyService.corrections(body);
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
}
