import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { AppearanceService } from './appearance.service';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

const spawnMock = spawn as jest.MockedFunction<typeof spawn>;

function fakeProcess(stdout: string, code = 0) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: jest.Mock;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  process.nextTick(() => {
    child.stdout.emit('data', Buffer.from(stdout));
    child.emit('close', code);
  });
  return child;
}

describe('AppearanceService', () => {
  const service = new AppearanceService();
  const file = {
    buffer: Buffer.from('photo'),
    mimetype: 'image/jpeg',
  } as Express.Multer.File;

  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('returns the pipeline JSON for a photo and classifier box', async () => {
    const payload = {
      status: 'success',
      garments: [
        {
          group: 'top',
          type: 't-shirt',
          confidence: 0.9,
          box: [1, 2, 3, 4],
          color: { primary: { name: 'navy', hex: '#1C2A5C', proportion: 1 } },
          pattern: { primary: 'solid', confidence: 0.8 },
          texture: { primary: 'cotton', confidence: 0.7 },
        },
      ],
      model_version: 'color-pattern-v1',
    };
    spawnMock.mockImplementation(
      () => fakeProcess(JSON.stringify(payload)) as never,
    );

    const result = await service.analyze(file, {
      classification: JSON.stringify([
        { type: 't-shirt', confidence: 0.9, box: [1, 2, 3, 4] },
      ]),
      k: 6,
    });

    expect(result).toEqual(payload);
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args[0]).toMatch(/pipeline\.py$/);
    expect(args).toEqual(expect.arrayContaining(['--k', '6']));
    expect(args).toContain('--classification');
  });

  it('rejects a missing photo', async () => {
    await expect(service.analyze(undefined, {})).rejects.toThrow(
      'Upload a garment photo as file',
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('rejects classification that is not JSON', async () => {
    await expect(
      service.analyze(file, { classification: 'not-json' }),
    ).rejects.toThrow('classification must be JSON');
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
