import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from './admin.guard';
import { BrandsService } from './brands.service';
import {
  CreateBrandDto,
  ResetBrandPasswordDto,
  SetBrandActiveDto,
} from './dto/brand.dto';

type AdminRequest = { adminUserId: string };

@ApiTags('brands')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('brands')
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a brand login and brand row',
    description:
      'Caller must be an admin. Uses the service role to create the auth user. The temporary password is returned once and is not stored.',
  })
  create(@Req() request: AdminRequest, @Body() dto: CreateBrandDto) {
    return this.brands.create(request.adminUserId, dto);
  }

  @Post(':brandId/password')
  @ApiOperation({ summary: 'Set a new temporary password for a brand login' })
  resetPassword(
    @Param('brandId', ParseUUIDPipe) brandId: string,
    @Body() dto: ResetBrandPasswordDto,
  ) {
    return this.brands.resetPassword(brandId, dto.password);
  }

  @Patch(':brandId/active')
  @ApiOperation({ summary: 'Activate or deactivate a brand' })
  setActive(
    @Param('brandId', ParseUUIDPipe) brandId: string,
    @Body() dto: SetBrandActiveDto,
  ) {
    return this.brands.setActive(brandId, dto.isActive);
  }
}
