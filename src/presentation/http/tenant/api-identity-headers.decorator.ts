import { applyDecorators } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';

/** Documents the identity headers that stand in for JWT claims (D4). */
export const ApiIdentityHeaders = () =>
  applyDecorators(
    ApiHeader({
      name: 'X-Tenant-ID',
      required: true,
      description: 'Stand-in for the JWT tenant claim (uuid)',
    }),
    ApiHeader({ name: 'X-User-ID', required: true, description: 'Stand-in for the JWT subject' }),
  );
