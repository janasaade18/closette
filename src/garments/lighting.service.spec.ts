import { LightingService } from './lighting.service';
import { MlRunnerService } from './ml-runner.service';

describe('LightingService', () => {
  const mlRunner = new MlRunnerService();
  const service = new LightingService(mlRunner);
  const file = {
    buffer: Buffer.from('photo'),
    mimetype: 'image/jpeg',
  } as Express.Multer.File;

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the lighting JSON from Python', async () => {
    const payload = {
      ok: false,
      score: 0.2,
      issues: ['too_dark'],
      guidance: 'Add more light',
    };
    const runPython = jest
      .spyOn(mlRunner, 'runPython')
      .mockResolvedValue(JSON.stringify(payload));

    await expect(service.check(file)).resolves.toEqual(payload);
    expect(runPython).toHaveBeenCalled();
  });
});
