import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { SupabaseService } from './supabase.service';

describe('SupabaseService', () => {
  let service: SupabaseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupabaseService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              if (key === 'SUPABASE_URL') return 'https://example.supabase.co';
              if (key === 'SUPABASE_SERVICE_ROLE_KEY') {
                return 'service-role-key';
              }
              throw new Error(`Missing ${key}`);
            },
            get: (key: string) =>
              key === 'SUPABASE_FOOT_SCANS_BUCKET' ? 'foot-scans' : undefined,
          },
        },
      ],
    }).compile();

    service = module.get<SupabaseService>(SupabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
