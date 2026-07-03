import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import { TrustService } from './trust.service';

@Controller('trust')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('moderator', 'agent')
export class TrustController {
  constructor(private readonly trust: TrustService) {}

  @Get('users/:id')
  async user(@Param('id') id: string) {
    const [score, signals] = await Promise.all([
      this.trust.riskScore(id),
      this.trust.listSignals(id),
    ]);
    return { ...score, recent: signals };
  }
}
