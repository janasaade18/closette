import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FitShoeDto } from './dto/fit-shoe.dto';
import { ShoesService } from './shoes.service';

@ApiTags('shoes')
@Controller('shoes')
export class ShoesController {
  constructor(private readonly shoesService: ShoesService) {}

  @Get()
  @ApiOperation({
    summary: 'List listed shoes (demo brand stand-ins until partners upload)',
  })
  async list() {
    const shoes = await this.shoesService.list();
    return shoes.map((shoe) => this.shoesService.toListItem(shoe));
  }

  @Get(':idOrSlug')
  @ApiOperation({ summary: 'Shoe detail including size run (inner mm)' })
  findOne(@Param('idOrSlug') idOrSlug: string) {
    return this.shoesService.findOne(idOrSlug);
  }

  @Get(':idOrSlug/try-on')
  @ApiOperation({
    summary: 'Try-on payload: mesh URL/format for AR overlay on the foot',
  })
  tryOn(@Param('idOrSlug') idOrSlug: string) {
    return this.shoesService.tryOn(idOrSlug);
  }

  @Post(':idOrSlug/fit')
  @ApiOperation({
    summary:
      'Recommend a size from foot length (scan measurements or manual mm for demos)',
  })
  fit(@Param('idOrSlug') idOrSlug: string, @Body() dto: FitShoeDto) {
    return this.shoesService.fit(idOrSlug, dto);
  }
}
