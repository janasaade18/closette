import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SupabaseModule } from '../supabase/supabase.module';
import { ReconstructionService } from './reconstruction.service';
import { Scan, ScanSchema } from './schemas/scan.schema';
import { ScansController } from './scans.controller';
import { ScansService } from './scans.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Scan.name, schema: ScanSchema }]),
    SupabaseModule,
  ],
  controllers: [ScansController],
  providers: [ScansService, ReconstructionService],
})
export class ScansModule {}
