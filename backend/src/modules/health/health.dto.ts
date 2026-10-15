import { ApiProperty } from '@nestjs/swagger';
import type { Liveness, Readiness } from '@ksm/shared';

export class LivenessDto implements Liveness {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;
}

class ReadinessChecksDto {
  @ApiProperty({ enum: ['up', 'down'] })
  database!: 'up' | 'down';
}

export class ReadinessDto implements Readiness {
  @ApiProperty({ enum: ['ok', 'unavailable'] })
  status!: 'ok' | 'unavailable';

  @ApiProperty({ type: ReadinessChecksDto })
  checks!: ReadinessChecksDto;

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;
}
