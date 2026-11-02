import { Matches } from 'class-validator';

/**
 * 8-4-4-4-12 hex, the format PostgreSQL's uuid type accepts. class-validator's IsUUID also checks
 * the RFC 4122 version nibble, which would reject valid database ids (e.g. the fixed seed ids).
 */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const IsUuidLike = () => Matches(UUID_PATTERN, { message: '$property must be a UUID' });
