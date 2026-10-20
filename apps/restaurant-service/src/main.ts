
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { RestaurantServiceModule } from './restaurant-service.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(RestaurantServiceModule);

  app.enableCors();

  app.useStaticAssets(
    join(process.cwd(), 'uploads', 'food-images'),
    { prefix: '/uploads/food-images/' },
  );

  const port = Number(process.env.RESTAURANT_SERVICE_PORT ?? 3003);

  await app.listen(port);

  console.log(`Restaurant Service running at http://localhost:${port}`);
}

bootstrap();
