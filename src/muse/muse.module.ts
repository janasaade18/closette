import { Module } from '@nestjs/common';
import { MuseController } from './muse.controller';
import { MuseChatService } from './muse-chat.service';
import { MuseHttpClient } from './muse-http.client';
import { WeatherClient } from './weather.client';

@Module({
  controllers: [MuseController],
  providers: [MuseChatService, MuseHttpClient, WeatherClient],
  exports: [MuseChatService, MuseHttpClient],
})
export class MuseModule {}
