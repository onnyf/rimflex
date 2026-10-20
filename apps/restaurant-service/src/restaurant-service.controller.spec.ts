import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { RestaurantServiceService } from './restaurant-service.service';

@Controller('restaurants')
export class RestaurantServiceController {
  constructor(
    private readonly restaurantServiceService: RestaurantServiceService,
  ) {}

  // =====================================
  // RESTAURANT ENDPOINTS
  // =====================================

  @Get()
  getRestaurants() {
    return this.restaurantServiceService.getRestaurants();
  }

  @Post()
  createRestaurant(@Body() body: any) {
    return this.restaurantServiceService.createRestaurant(body);
  }

  // =====================================
  // MENU CATEGORY ENDPOINTS
  // =====================================

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

  @Get(':restaurantId/menu-categories')
  getMenuCategories(
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.restaurantServiceService.getMenuCategories(
      restaurantId,
    );
  }

  // =====================================
  // MENU ITEM ENDPOINTS
  // =====================================

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

  // Delete a food item
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
