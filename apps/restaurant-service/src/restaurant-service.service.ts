import { NotFoundException } from '@nestjs/common';
import { Temporal } from '@js-temporal/polyfill';
import {
  BadRequestException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE } from './database.provider';

@Injectable()
export class RestaurantServiceService {
  constructor(
    @Inject(DATABASE)
    private readonly db: any,
  ) {}

  // =====================================
  // RESTAURANTS
  // =====================================

  async getRestaurants() {
    return this.db.orm.public.Restaurant.all();
  }

  async getPublicRestaurants() {
    return this.db.orm.public.Restaurant
      .where({
        status: 'APPROVED',
        isActive: true,
      })
      .all();
  }

  async getPublicRestaurantById(restaurantId: string) {
    const restaurant = await this.db.orm.public.Restaurant
      .where({
        id: restaurantId,
        status: 'APPROVED',
        isActive: true,
      })
      .first();

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    return restaurant;
  }


  async createRestaurant(data: any) {
    const requiredFields = [
      'ownerId',
      'name',
      'phone',
      'streetAddress',
      'city',
      'state',
    ];

    for (const field of requiredFields) {
      if (
        typeof data?.[field] !== 'string' ||
        !data[field].trim()
      ) {
        throw new BadRequestException(
          `${field} is required`,
        );
      }
    }

    const slug = data.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    if (!slug) {
      throw new BadRequestException(
        'Restaurant name must contain letters or numbers',
      );
    }

    return this.db.orm.public.Restaurant.create({
      ownerId: data.ownerId.trim(),
      name: data.name.trim(),
      slug: `${slug}-${randomUUID().slice(0, 8)}`,
      phone: data.phone.trim(),
      streetAddress: data.streetAddress.trim(),
      city: data.city.trim(),
      state: data.state.trim(),
      country: 'Nigeria',
      description: data.description ?? null,
    });
  }

  // =====================================
  // MENU CATEGORIES
  // =====================================

  async createMenuCategory(
    restaurantId: string,
    data: any,
  ) {
    const restaurant = await this.db.orm.public.Restaurant
      .where({ id: restaurantId })
      .first();

    if (!restaurant) {
      throw new BadRequestException(
        'Restaurant not found',
      );
    }

    if (
      typeof data?.name !== 'string' ||
      !data.name.trim()
    ) {
      throw new BadRequestException(
        'Menu category name is required',
      );
    }

    return this.db.orm.public.MenuCategory.create({
      restaurantId,
      name: data.name.trim(),
      description: data.description ?? null,
      sortOrder: 0,
      isActive: true,
    });
  }

  async getMenuCategories(restaurantId: string) {
    return this.db.orm.public.MenuCategory
      .where({ restaurantId })
      .all();
  }

  async getPublicMenuCategories(restaurantId: string) {
    const restaurant = await this.db.orm.public.Restaurant
      .where({
        id: restaurantId,
        status: 'APPROVED',
        isActive: true,
      })
      .first();

    if (!restaurant) {
      return [];
    }

    return this.db.orm.public.MenuCategory
      .where({
        restaurantId,
        isActive: true,
      })
      .all();
  }


  // =====================================
  // FOOD / MENU ITEMS
  // =====================================

  async createMenuItem(
    restaurantId: string,
    data: any,
  ) {
    // Confirm the restaurant exists
    const restaurant = await this.db.orm.public.Restaurant
      .where({ id: restaurantId })
      .first();

    if (!restaurant) {
      throw new BadRequestException(
        'Restaurant not found',
      );
    }

    // Validate food name
    if (
      typeof data?.name !== 'string' ||
      !data.name.trim()
    ) {
      throw new BadRequestException(
        'Food name is required',
      );
    }

    // Validate menu category
    if (
      typeof data?.menuCategoryId !== 'string' ||
      !data.menuCategoryId.trim()
    ) {
      throw new BadRequestException(
        'Menu category ID is required',
      );
    }

    // Confirm category belongs to restaurant
    const category = await this.db.orm.public.MenuCategory
      .where({
        id: data.menuCategoryId.trim(),
        restaurantId,
      })
      .first();

    if (!category) {
      throw new BadRequestException(
        'Menu category does not belong to this restaurant',
      );
    }

    // Validate price
    if (
      data?.price === undefined ||
      data?.price === null ||
      data?.price === '' ||
      typeof data.price === 'boolean'
    ) {
      throw new BadRequestException(
        'Valid food price is required',
      );
    }

    const price = Number(data.price);

    if (
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isInteger(price * 100)
    ) {
      throw new BadRequestException(
        'Price must be greater than zero and have at most two decimal places',
      );
    }

    // Save food item
    return this.db.orm.public.MenuItem.create({
      restaurantId,
      menuCategoryId: category.id,
      name: data.name.trim(),
      description: data.description ?? null,
      price: price.toFixed(2),
      status: 'AVAILABLE',
      isFeatured: false,
    });
  }

  async getMenuItems(restaurantId: string) {
    return this.db.orm.public.MenuItem
      .where({ restaurantId })
      .all();
  }

  async getPublicMenuItems(restaurantId: string) {
    const restaurant = await this.db.orm.public.Restaurant
      .where({
        id: restaurantId,
        status: 'APPROVED',
        isActive: true,
      })
      .first();

    if (!restaurant) {
      return [];
    }

    const categories = await this.db.orm.public.MenuCategory
      .where({
        restaurantId,
        isActive: true,
      })
      .all();

    const activeCategoryIds = new Set(
      categories.map((category: any) => category.id),
    );

    const items = await this.db.orm.public.MenuItem
      .where({
        restaurantId,
        status: 'AVAILABLE',
      })
      .all();

    return items.filter((item: any) =>
      activeCategoryIds.has(item.menuCategoryId),
    );
  }


  async updateMenuItem(
    restaurantId: string,
    itemId: string,
    data: any,
  ) {
    const item = await this.db.orm.public.MenuItem
      .where({
        id: itemId,
        restaurantId,
      })
      .first();

    if (!item) {
      throw new BadRequestException(
        'Food item not found for this restaurant',
      );
    }

    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data)
    ) {
      throw new BadRequestException(
        'Valid update data is required',
      );
    }

    const updates: Record<string, any> = {};

    if (data.name !== undefined) {
      if (
        typeof data.name !== 'string' ||
        !data.name.trim()
      ) {
        throw new BadRequestException(
          'Food name cannot be empty',
        );
      }

      updates.name = data.name.trim();
    }

    if (data.description !== undefined) {
      if (
        data.description !== null &&
        typeof data.description !== 'string'
      ) {
        throw new BadRequestException(
          'Description must be text or null',
        );
      }

      updates.description = data.description;
    }

    if (data.price !== undefined) {
      const price = Number(data.price);

      if (
        data.price === null ||
        typeof data.price === 'boolean' ||
        data.price === '' ||
        !Number.isFinite(price) ||
        price <= 0 ||
        !Number.isInteger(price * 100)
      ) {
        throw new BadRequestException(
          'Price must be positive with at most two decimal places',
        );
      }

      updates.price = price.toFixed(2);
    }

    if (data.discountPrice !== undefined) {
      if (data.discountPrice === null) {
        updates.discountPrice = null;
      } else {
        const discount = Number(data.discountPrice);

        if (
          typeof data.discountPrice === 'boolean' ||
          data.discountPrice === '' ||
          !Number.isFinite(discount) ||
          discount < 0 ||
          !Number.isInteger(discount * 100)
        ) {
          throw new BadRequestException(
            'Invalid discount price',
          );
        }

        updates.discountPrice = discount.toFixed(2);
      }
    }

    if (data.status !== undefined) {
      const allowedStatuses = [
        'AVAILABLE',
        'UNAVAILABLE',
        'OUT_OF_STOCK',
      ];

      if (!allowedStatuses.includes(data.status)) {
        throw new BadRequestException(
          'Invalid food availability status',
        );
      }

      updates.status = data.status;
    }

    if (data.preparationMinutes !== undefined) {
      if (
        data.preparationMinutes !== null &&
        (
          !Number.isInteger(data.preparationMinutes) ||
          data.preparationMinutes < 0
        )
      ) {
        throw new BadRequestException(
          'Preparation time must be a non-negative whole number or null',
        );
      }

      updates.preparationMinutes =
        data.preparationMinutes;
    }

    if (data.isFeatured !== undefined) {
      if (typeof data.isFeatured !== 'boolean') {
        throw new BadRequestException(
          'isFeatured must be true or false',
        );
      }

      updates.isFeatured = data.isFeatured;
    }

    if (data.imageUrl !== undefined) {
      if (
        data.imageUrl !== null &&
        (
          typeof data.imageUrl !== 'string' ||
          !/^https?:\/\/\S+$/i.test(data.imageUrl)
        )
      ) {
        throw new BadRequestException(
          'Image URL must be a valid HTTP or HTTPS URL, or null',
        );
      }

      updates.imageUrl = data.imageUrl;
    }

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException(
        'No supported fields provided for update',
      );
    }

    const finalPrice = Number(
      updates.price ?? item.price,
    );

    const finalDiscount =
      updates.discountPrice !== undefined
        ? updates.discountPrice
        : item.discountPrice;

    if (
      finalDiscount !== null &&
      finalDiscount !== undefined &&
      Number(finalDiscount) >= finalPrice
    ) {
      throw new BadRequestException(
        'Discount price must be lower than the regular price',
      );
    }

   return this.db.orm.public.MenuItem
  .where({ id: itemId, restaurantId })
  .update({
    ...updates,
    updatedAt: Temporal.Now.instant(),
  });
  }

  // =====================================
  // DELETE FOOD / MENU ITEM
  // =====================================

  async deleteMenuItem(
    restaurantId: string,
    itemId: string,
  ) {
    // Confirm that the food item belongs to this restaurant
    const item = await this.db.orm.public.MenuItem
      .where({
        id: itemId,
        restaurantId,
      })
      .first();

    if (!item) {
      throw new BadRequestException(
        'Food item not found for this restaurant',
      );
    }

    // Delete only the matching restaurant's food item
    await this.db.orm.public.MenuItem
      .where({
        id: itemId,
        restaurantId,
      })
      .delete();

    return {
      success: true,
      message: 'Food item deleted successfully',
      deletedItemId: itemId,
    };
  }

}
