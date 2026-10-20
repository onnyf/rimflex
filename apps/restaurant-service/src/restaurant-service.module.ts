
import { Module } from '@nestjs/common';
import { RestaurantServiceController } from './restaurant-service.controller';
import { RestaurantServiceService } from './restaurant-service.service';
import { databaseProvider } from './database.provider';

@Module({
  imports: [],
  controllers: [RestaurantServiceController],
  providers: [
    RestaurantServiceService,
    databaseProvider,
  ],
  exports: [databaseProvider],
})
export class RestaurantServiceModule {}
