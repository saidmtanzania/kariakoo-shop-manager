import { Injectable } from '@nestjs/common';
import { hash, verify, type Algorithm } from '@node-rs/argon2';

// OWASP-recommended Argon2id parameters (19 MiB, 2 iterations, 1 lane).
// `Algorithm` is a const enum, which isolatedModules cannot read; 2 is Argon2id.
const ARGON2ID = 2 as Algorithm;
const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class PasswordService {
  /** Hash used to keep login timing the same when the email is unknown. */
  private readonly dummyHash = hash(
    'timing-equaliser-not-a-real-password',
    OPTIONS,
  );

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(
    passwordHash: string | null,
    password: string,
  ): Promise<boolean> {
    const target = passwordHash ?? (await this.dummyHash);
    try {
      const ok = await verify(target, password);
      return passwordHash !== null && ok;
    } catch {
      return false;
    }
  }
}
