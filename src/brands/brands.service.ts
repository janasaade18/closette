import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateBrandDto } from './dto/brand.dto';

type BrandRecord = {
  id: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  owner_user_id: string;
  created_by: string | null;
  is_active: boolean;
  created_at: string;
};

type QueryError = { message: string } | null;

type QueryResult<T> = {
  data: T;
  error: QueryError;
};

@Injectable()
export class BrandsService {
  constructor(private readonly supabase: SupabaseService) {}

  async create(createdBy: string, input: CreateBrandDto) {
    const client = this.supabase.getClient();
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    const description = input.description?.trim() || null;

    const { data: created, error: createError } =
      await client.auth.admin.createUser({
        email,
        password: input.password,
        email_confirm: true,
        user_metadata: { display_name: name },
      });

    if (createError || !created.user) {
      const message =
        createError?.message ?? 'Could not create the brand login.';
      if (/already|registered|exists/i.test(message)) {
        throw new ConflictException('That email already has an account.');
      }
      throw new BadRequestException(message);
    }

    const ownerId = created.user.id;
    try {
      await this.ensureUser(client, ownerId, email, name);
      const inserted = (await client
        .from('brands')
        .insert({
          name,
          description,
          owner_user_id: ownerId,
          created_by: createdBy,
          is_active: true,
        })
        .select('*')
        .single()) as QueryResult<BrandRecord | null>;

      if (inserted.error || !inserted.data) {
        throw new BadRequestException(
          inserted.error?.message ?? 'Could not create the brand.',
        );
      }

      return {
        brand: inserted.data,
        ownerEmail: email,
        temporaryPassword: input.password,
      };
    } catch (error) {
      await client.auth.admin.deleteUser(ownerId);
      throw error;
    }
  }

  async resetPassword(brandId: string, password: string) {
    const client = this.supabase.getClient();
    const brand = await this.loadBrand(client, brandId);
    const { error } = await client.auth.admin.updateUserById(
      brand.owner_user_id,
      { password },
    );
    if (error) {
      throw new BadRequestException(error.message);
    }
    return {
      brandId,
      ownerEmail: brand.email,
      temporaryPassword: password,
    };
  }

  async setActive(brandId: string, isActive: boolean) {
    const client = this.supabase.getClient();
    const updated = (await client
      .from('brands')
      .update({ is_active: isActive })
      .eq('id', brandId)
      .select('*')
      .maybeSingle()) as QueryResult<BrandRecord | null>;

    if (updated.error) {
      throw new BadRequestException(updated.error.message);
    }
    if (!updated.data) {
      throw new NotFoundException('Brand not found.');
    }
    return { brand: updated.data };
  }

  private async ensureUser(
    client: SupabaseClient,
    ownerId: string,
    email: string,
    name: string,
  ) {
    const profile = {
      email,
      display_name: name,
      role: 'user',
      onboarding_completed_at: new Date().toISOString(),
    };
    const updated = (await client
      .from('users')
      .update(profile)
      .eq('id', ownerId)
      .select('id')) as QueryResult<{ id: string }[] | null>;

    if (updated.error) {
      throw new BadRequestException(updated.error.message);
    }
    if (updated.data?.length) return;

    const { error: insertError } = await client.from('users').insert({
      id: ownerId,
      ...profile,
    });
    if (insertError) {
      throw new BadRequestException(insertError.message);
    }
  }

  private async loadBrand(client: SupabaseClient, brandId: string) {
    const loaded = (await client
      .from('brands')
      .select('id, owner_user_id')
      .eq('id', brandId)
      .maybeSingle()) as QueryResult<{
      id: string;
      owner_user_id: string;
    } | null>;

    if (loaded.error) {
      throw new BadRequestException(loaded.error.message);
    }
    if (!loaded.data?.owner_user_id) {
      throw new NotFoundException('Brand not found.');
    }

    const owner = (await client
      .from('users')
      .select('email')
      .eq('id', loaded.data.owner_user_id)
      .maybeSingle()) as QueryResult<{ email: string | null } | null>;

    return {
      owner_user_id: loaded.data.owner_user_id,
      email: owner.data?.email ?? null,
    };
  }
}
