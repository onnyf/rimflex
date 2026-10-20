
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';


import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RestaurantServiceService } from './restaurant-service.service';

@Controller('restaurants')
export class RestaurantServiceController {
  constructor(
    private readonly restaurantServiceService: RestaurantServiceService,
  ) {}

  // =====================================
  // RESTAURANT ENDPOINTS
  // =====================================

  // Get all restaurants
  @Get()
  getRestaurants() {
    return this.restaurantServiceService.getRestaurants();
  }

  // Public customer restaurant discovery
  @Get('public')
  getPublicRestaurants() {
    return this.restaurantServiceService.getPublicRestaurants();
  }

  // Customer-facing details for approved, active restaurants
  @Get('public/:restaurantId')
  getPublicRestaurantById(
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.restaurantServiceService.getPublicRestaurantById(
      restaurantId,
    );
  }
  // Register a new restaurant
  @Post()
  createRestaurant(@Body() body: any) {
    return this.restaurantServiceService.createRestaurant(body);
  }

  // =====================================
  // MENU CATEGORY ENDPOINTS
  // =====================================

  // Create a menu category
  @Post(':restaurantId/menu-categories')
  createMenuCategory(
    @Param('restaurantId') restaurantId: string,
    @Body() body: any,
  ) {
    return this.restaurantServiceService.createMenuCategory(
      restaurantId,
      body,
    );
  }

  // Get all categories for a restaurant
  // Customer-facing categories for approved, active restaurants
  @Get(':restaurantId/public-menu-categories')
  getPublicMenuCategories(
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.restaurantServiceService.getPublicMenuCategories(
      restaurantId,
    );
  }
  @Get(':restaurantId/menu-categories')
  getMenuCategories(
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.restaurantServiceService.getMenuCategories(
      restaurantId,
    );
  }

  // =====================================
  // FOOD / MENU ITEM ENDPOINTS
  // =====================================

  // Add a food item to a restaurant menu
  @Post(':restaurantId/menu-items')
  createMenuItem(
    @Param('restaurantId') restaurantId: string,
    @Body() body: any,
  ) {
    return this.restaurantServiceService.createMenuItem(
      restaurantId,
      body,
    );
  }

  // Get all food items for a restaurant
  // Customer-facing menu: approved restaurants and available food only
  @Get(':restaurantId/public-menu-items')
  getPublicMenuItems(
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.restaurantServiceService.getPublicMenuItems(
      restaurantId,
    );
  }
  @Get(':restaurantId/menu-items')
  getMenuItems(
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.restaurantServiceService.getMenuItems(
      restaurantId,
    );
  }

  // Update an existing food item
  @Patch(':restaurantId/menu-items/:itemId')
  updateMenuItem(
    @Param('restaurantId') restaurantId: string,
    @Param('itemId') itemId: string,
    @Body() body: any,
  ) {
    return this.restaurantServiceService.updateMenuItem(
      restaurantId,
      itemId,
      body,
    );
  }

  // =====================================
  // FOOD IMAGE UPLOAD
  // =====================================

  @Post(':restaurantId/menu-items/:itemId/image')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: diskStorage({
        destination: './uploads/food-images',
        filename: (_req, file, callback) => {
          callback(
            null,
            `${randomUUID()}${extname(file.originalname).toLowerCase()}`,
          );
        },
      }),
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
      fileFilter: (_req, file, callback) => {
        const allowedTypes = [
          'image/jpeg',
          'image/png',
          'image/webp',
        ];

        if (!allowedTypes.includes(file.mimetype)) {
          return callback(
            new BadRequestException('Only JPG, PNG and WEBP images are allowed'),
            false,
          );
        }

        callback(null, true);
      },
    }),
  )
  async uploadMenuItemImage(
    @Param('restaurantId') restaurantId: string,
    @Param('itemId') itemId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Food image is required');
    }

    const imageUrl = `http://localhost:3003/uploads/food-images/${file.filename}`;

    await this.restaurantServiceService.updateMenuItem(
      restaurantId,
      itemId,
      { imageUrl },
    );

    return {
      success: true,
      imageUrl,
    };
  }
  // =====================================
  // DELETE MENU ITEM
  // =====================================

  @Delete(':restaurantId/menu-items/:itemId')
  deleteMenuItem(
    @Param('restaurantId') restaurantId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.restaurantServiceService.deleteMenuItem(
      restaurantId,
      itemId,
    );
  }
}
