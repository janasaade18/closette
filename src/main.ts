import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { Server } from 'http';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  const config = new DocumentBuilder()
    .setTitle('Closette API')
    .setDescription(
      'Closette foot model: phone guides capture and uploads frames (markerless scale via device AR). This API plus the Python worker reconstruct the 3D foot for shoe-size fit and AR try-on. No physical calibration tools.',
    )
    .setVersion('0.1')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // Closet save can take a while on first warm cutout — don't kill the socket early.
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
  const server = app.getHttpServer() as Server;
  server.setTimeout(180_000);
  server.headersTimeout = 190_000;
  server.requestTimeout = 180_000;
  server.keepAliveTimeout = 120_000;
}
void bootstrap();
