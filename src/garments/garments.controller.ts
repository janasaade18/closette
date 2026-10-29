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
import { GarmentsService } from './garments.service';

@ApiTags('garments')
@Controller('garments')
export class GarmentsController {
  constructor(
    private readonly garmentsService: GarmentsService,
    private readonly appearanceService: AppearanceService,
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

  @Post('appearance')
  @ApiOperation({
    summary: 'Type, color, pattern, and texture for every garment in one photo',
    description:
      'Runs garment detection unless classification is sent. Each item includes group, type, confidence, box, color, pattern, and texture. A pattern or texture score under 0.55 comes back as unknown.',
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
