import { Module } from '@nestjs/common';
import { AppearanceService } from './appearance.service';
import { GarmentsController } from './garments.controller';
import { GarmentsService } from './garments.service';

@Module({
  controllers: [GarmentsController],
  providers: [GarmentsService, AppearanceService],
  exports: [GarmentsService],
})
export class GarmentsModule {}
