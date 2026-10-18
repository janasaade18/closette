import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CreateScanDto } from './dto/create-scan.dto';
import { UploadFrameDto } from './dto/upload-frame.dto';
import { ParseObjectIdPipe } from './pipes/parse-object-id.pipe';
import { ScansService } from './scans.service';

@ApiTags('scans')
@Controller('scans')
export class ScansController {
  constructor(private readonly scansService: ScansService) {}

  @Get('guides')
  @ApiOperation({
    summary: 'Guided foot-scan protocol for the phone',
    description:
      'Render these instructions. Capture 30–60 accepted frames. The server reconstructs the 3D foot.',
  })
  @ApiOkResponse({ description: 'Capture guides and frame targets' })
  getGuides() {
    return this.scansService.getGuides();
  }

  @Post()
  @ApiOperation({ summary: 'Start a one-foot scan session' })
  @ApiCreatedResponse({ description: 'Scan session created' })
  create(@Body() dto: CreateScanDto) {
    return this.scansService.create(dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Poll scan, saved frames, and reconstruction',
  })
  @ApiOkResponse({ description: 'Full Phase 1 scan record' })
  findOne(@Param('id', ParseObjectIdPipe) id: string) {
    return this.scansService.findOne(id);
  }

  @Post(':id/frames')
  @ApiOperation({
    summary: 'Upload one filtered frame',
    description:
      'Phone should discard blurry / no-foot / tiny-foot frames first. Upload only useful stills.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'view'],
      properties: {
        file: { type: 'string', format: 'binary' },
        view: {
          type: 'string',
          enum: ['top', 'front', 'left', 'right', 'heel'],
        },
        capturedAt: { type: 'string', format: 'date-time' },
        sharpness: { type: 'number' },
        footVisible: { type: 'boolean' },
        footAreaRatio: { type: 'number' },
        accepted: { type: 'boolean' },
        pose: { type: 'string', description: 'JSON camera pose if available' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  addFrame(
    @Param('id', ParseObjectIdPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadFrameDto,
  ) {
    return this.scansService.addFrame(id, file, dto);
  }

  @Post(':id/complete')
  @ApiOperation({
    summary: 'Finish capture and enqueue 3D reconstruction',
    description:
      'Requires 30+ accepted frames and at least 6 per view. Server produces foot.glb when the worker is ready.',
  })
  @ApiOkResponse({ description: 'Processing / reconstruction status' })
  complete(@Param('id', ParseObjectIdPipe) id: string) {
    return this.scansService.complete(id);
  }
}
