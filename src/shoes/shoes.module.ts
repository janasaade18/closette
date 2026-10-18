import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { FileShoeCatalog } from './file-shoe.catalog';
import { ShoeRepository } from './shoe.repository';
import { ShoesController } from './shoes.controller';
import { ShoesService } from './shoes.service';

@Module({
  imports: [SupabaseModule],
  controllers: [ShoesController],
  providers: [ShoesService, ShoeRepository, FileShoeCatalog],
  exports: [ShoesService],
})
export class ShoesModule {}
