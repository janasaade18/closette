import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SupabaseModule } from './supabase/supabase.module';
import { ScansModule } from './scans/scans.module';
import { ShoesModule } from './shoes/shoes.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    SupabaseModule,
    ScansModule,
    ShoesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
