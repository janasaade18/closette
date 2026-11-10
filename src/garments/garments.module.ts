import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { AppearanceService } from './appearance.service';
import { GarmentsController } from './garments.controller';
import { GarmentsService } from './garments.service';
import { LightingService } from './lighting.service';
import { MlRunnerService } from './ml-runner.service';
import { SaveGarmentService } from './save.service';

@Module({
  imports: [SupabaseModule],
  controllers: [GarmentsController],
  providers: [
    GarmentsService,
    AppearanceService,
    LightingService,
    SaveGarmentService,
    MlRunnerService,
  ],
  exports: [GarmentsService],
})
export class GarmentsModule {}
