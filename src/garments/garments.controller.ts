import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GarmentsService } from './garments.service';

@ApiTags('garments')
@Controller('garments')
export class GarmentsController {
  constructor(private readonly garmentsService: GarmentsService) {}

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
}
