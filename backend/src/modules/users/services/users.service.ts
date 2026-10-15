import { Injectable } from '@nestjs/common';
import { newId } from '../../../common/ids/ids.js';
import {
  Prisma,
  PrismaService,
  UserStatus,
  type User,
} from '../../../database/index.js';

type Db = PrismaService | Prisma.TransactionClient;

/** Global identities (not shop-scoped). */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string, db: Db = this.prisma): Promise<User | null> {
    return db.user.findUnique({ where: { email: normalizeEmail(email) } });
  }

  findActiveById(id: string, db: Db = this.prisma): Promise<User | null> {
    return db.user.findFirst({ where: { id, status: UserStatus.ACTIVE } });
  }

  create(
    input: { email: string; fullName: string; passwordHash: string },
    db: Db = this.prisma,
  ): Promise<User> {
    return db.user.create({
      data: {
        id: newId(),
        email: normalizeEmail(input.email),
        fullName: input.fullName.trim(),
        passwordHash: input.passwordHash,
      },
    });
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
