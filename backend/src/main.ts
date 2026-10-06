import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors(); // Restringir origens quando o frontend tiver domínio definido.
  app.enableShutdownHooks(); // Necessário para o onModuleDestroy do PrismaService.

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}

void bootstrap();
