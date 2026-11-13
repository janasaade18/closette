import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { AdminGuard } from './admin.guard';
import { BrandsController } from './brands.controller';
import { BrandsService } from './brands.service';

@Module({
  imports: [SupabaseModule],
  controllers: [BrandsController],
  providers: [BrandsService, AdminGuard],
})
export class BrandsModule {}
