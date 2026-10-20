import { Module } from '@nestjs/common';
import { databaseProvider } from './database.provider';
import { AuthServiceController } from './auth-service.controller';
import { AuthServiceService } from './auth-service.service';

@Module({
  imports: [],
  controllers: [AuthServiceController],
  providers: [AuthServiceService, databaseProvider],
})
export class AuthServiceModule {}
