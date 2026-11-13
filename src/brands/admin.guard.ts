import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

type AdminRequest = {
  headers: { authorization?: string };
  adminUserId?: string;
};

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
      throw new UnauthorizedException('Sign in as an admin first.');
    }

    const client = this.supabase.getClient();
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedException('Sign in as an admin first.');
    }

    const { data: profile, error: profileError } = await client
      .from('users')
      .select('role')
      .eq('id', data.user.id)
      .maybeSingle();

    if (profileError) {
      throw new InternalServerErrorException(profileError.message);
    }
    if (profile?.role !== 'admin') {
      throw new ForbiddenException('Only an admin can manage brand accounts.');
    }

    request.adminUserId = data.user.id;
    return true;
  }
}
