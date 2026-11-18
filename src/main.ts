import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express from 'express';
import { AppModule } from './app.module';

export function configureApp(
  app: INestApplication,
  options?: { enableSwagger?: boolean },
): INestApplication {
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ limit: '100kb', extended: true }));

  const origins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:5173'];
  app.enableCors({
    origin: origins,
    credentials: true,
  });

  app.setGlobalPrefix('api/v1', {
    exclude: [
      'health',
      'health/(.*)',
      'api/v1/health',
      'api/v1/health/(.*)',
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (options?.enableSwagger !== false) {
    const config = new DocumentBuilder()
      .setTitle('Online Exam API')
      .setDescription(
        'API documentation for the online multiple-choice exam system',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);

    SwaggerModule.setup('docs', app, document);
  }

  return app;
}

export async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  await app.listen(process.env.PORT ?? 3000);
}

if (require.main === module) {
  void bootstrap();
}
