import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { FootScanRepository } from './foot-scan.repository';
import { ReconstructionService } from './reconstruction.service';
import { ScansController } from './scans.controller';
import { ScansService } from './scans.service';

@Module({
  imports: [SupabaseModule],
  controllers: [ScansController],
  providers: [ScansService, ReconstructionService, FootScanRepository],
})
export class ScansModule {}
