import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { BrandsService } from './brands.service';
import { SupabaseService } from '../supabase/supabase.service';

describe('BrandsService', () => {
  const createUser = jest.fn();
  const deleteUser = jest.fn();
  const updateUserById = jest.fn();
  const from = jest.fn();
  const client = {
    auth: { admin: { createUser, deleteUser, updateUserById } },
    from,
  };
  const supabase = {
    getClient: () => client,
  } as unknown as SupabaseService;
  const service = new BrandsService(supabase);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects an email that already has an account', async () => {
    createUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'User already registered' },
    });

    await expect(
      service.create('admin-id', {
        name: 'Atelier',
        email: 'brand@example.com',
        password: 'secret1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('deletes the auth user when the brand row cannot be saved', async () => {
    createUser.mockResolvedValue({
      data: { user: { id: 'owner-id' } },
      error: null,
    });
    from.mockImplementation((table: string) => {
      if (table === 'users') {
        return {
          update: () => ({
            eq: () => ({
              select: () =>
                Promise.resolve({ data: [{ id: 'owner-id' }], error: null }),
            }),
          }),
        };
      }
      return {
        insert: () => ({
          select: () => ({
            single: () =>
              Promise.resolve({
                data: null,
                error: { message: 'duplicate owner' },
              }),
          }),
        }),
      };
    });

    await expect(
      service.create('admin-id', {
        name: 'Atelier',
        email: 'brand@example.com',
        password: 'secret1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(deleteUser).toHaveBeenCalledWith('owner-id');
  });

  it('returns not found when resetting a missing brand', async () => {
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    });

    await expect(
      service.resetPassword('missing', 'secret1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(updateUserById).not.toHaveBeenCalled();
  });
});
