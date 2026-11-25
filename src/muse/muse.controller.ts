import { Body, Controller, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MuseChatDto } from './dto/muse-chat.dto';
import { MuseChatService } from './muse-chat.service';

@ApiTags('muse')
@Controller('muse')
export class MuseController {
  constructor(private readonly museChat: MuseChatService) {}

  @Post('chat')
  @ApiOperation({
    summary: 'Muse conversational fashion stylist',
    description:
      'Gemini orchestrates with Closette tools. Outfits and travel packs come only from the Muse engine (MLP + LinUCB + marketplace + travel). See src/muse/INTEGRATION.md.',
  })
  @ApiOkResponse({
    description: '{ text, outfit?, travel?, context?, status? }',
  })
  chat(@Body() body: MuseChatDto) {
    return this.museChat.chat(body);
  }
}
