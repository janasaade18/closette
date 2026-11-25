import { MuseChatService } from './muse-chat.service';
import { MuseHttpClient } from './muse-http.client';
import { WeatherClient } from './weather.client';

describe('MuseChatService', () => {
  const muse = {} as MuseHttpClient;
  const weather = {} as WeatherClient;
  const config = { get: jest.fn() };

  it('refuses off-topic coding asks without calling Gemini', async () => {
    const service = new MuseChatService(config as never, muse, weather);
    const result = await service.chat({
      userId: 'user-1',
      message: 'Write python code to scrape a website',
      history: [],
    });
    expect(result.text).toMatch(/fashion and personal styling/i);
    expect(result.outfit).toBeUndefined();
    expect(config.get).not.toHaveBeenCalled();
  });
});
