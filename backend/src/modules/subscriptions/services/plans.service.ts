import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  BillingSettingsInput,
  BillingSettingsView,
  FeatureKey,
  PlanView,
} from '@ksm/shared';
import type {
  AuthContext,
  ClientInfo,
} from '../../../common/auth/request-context.js';
import { newId } from '../../../common/ids/ids.js';
import { Prisma, PrismaService } from '../../../database/index.js';
import { AuditService } from '../../audit/services/audit.service.js';
import type { CreatePlanDto, UpdatePlanDto } from '../dto/plan.dto.js';
import { SubscriptionsService } from './subscriptions.service.js';

type PlanWithFeatures = Prisma.PlanGetPayload<{ include: { features: true } }>;

function toPlanView(plan: PlanWithFeatures): PlanView {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    interval: plan.interval,
    price: plan.price.toFixed(2),
    currency: plan.currency,
    graceDays: plan.graceDays,
    active: plan.active,
    sortOrder: plan.sortOrder,
    features: plan.features
      .map((f) => ({
        featureKey: f.featureKey as FeatureKey,
        enabled: f.enabled,
        limitValue: f.limitValue,
      }))
      .sort((a, b) => a.featureKey.localeCompare(b.featureKey)),
  };
}

function assertUniqueFeatures(features: { featureKey: string }[] | undefined) {
  const keys = features?.map((f) => f.featureKey) ?? [];
  if (new Set(keys).size !== keys.length) {
    throw new BadRequestException({
      message: 'Each feature can appear only once.',
      code: 'duplicate_feature',
    });
  }
}

const notFound = () =>
  new NotFoundException({ message: 'Plan not found.', code: 'plan_not_found' });

/**
 * The platform price list (decision D-005: plans are data). Prices and
 * limits are entered by platform staff; nothing here invents a figure.
 */
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly audit: AuditService,
  ) {}

  /** Plans a shop can choose. */
  async listActive(): Promise<PlanView[]> {
    const plans = await this.prisma.plan.findMany({
      where: { active: true },
      include: { features: true },
      orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
    });
    return plans.map(toPlanView);
  }

  async listAll(): Promise<PlanView[]> {
    const plans = await this.prisma.plan.findMany({
      include: { features: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return plans.map(toPlanView);
  }

  async create(
    auth: AuthContext,
    dto: CreatePlanDto,
    client: ClientInfo,
  ): Promise<PlanView> {
    assertUniqueFeatures(dto.features);
    const id = newId();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.plan.create({
          data: {
            id,
            code: dto.code.trim(),
            name: dto.name.trim(),
            interval: dto.interval,
            price: new Prisma.Decimal(dto.price),
            graceDays: dto.graceDays ?? 3,
            active: dto.active ?? true,
            sortOrder: dto.sortOrder ?? 0,
          },
        });
        await tx.planFeature.createMany({
          data: dto.features.map((f) => ({
            planId: id,
            featureKey: f.featureKey,
            enabled: f.enabled,
            limitValue: f.limitValue,
          })),
        });
        await this.audit.record(
          {
            action: 'platform.plan_created',
            actorUserId: auth.userId,
            entityType: 'plan',
            entityId: id,
            after: { ...dto, features: dto.features.map((f) => ({ ...f })) },
            client,
          },
          tx,
        );
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          message: 'A plan with this code already exists.',
          code: 'plan_code_taken',
        });
      }
      throw err;
    }
    return this.get(id);
  }

  /**
   * Edits name, price, grace, order, availability and features. Code and
   * interval never change. A new price applies to payments started after the
   * change; payments already started keep their amount.
   */
  async update(
    auth: AuthContext,
    planId: string,
    dto: UpdatePlanDto,
    client: ClientInfo,
  ): Promise<PlanView> {
    assertUniqueFeatures(dto.features);
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.plan.findUnique({
        where: { id: planId },
        include: { features: true },
      });
      if (!before) throw notFound();
      await tx.plan.update({
        where: { id: planId },
        data: {
          name: dto.name?.trim(),
          price:
            dto.price === undefined ? undefined : new Prisma.Decimal(dto.price),
          graceDays: dto.graceDays,
          active: dto.active,
          sortOrder: dto.sortOrder,
        },
      });
      if (dto.features) {
        await tx.planFeature.deleteMany({ where: { planId } });
        await tx.planFeature.createMany({
          data: dto.features.map((f) => ({
            planId,
            featureKey: f.featureKey,
            enabled: f.enabled,
            limitValue: f.limitValue,
          })),
        });
      }
      await this.audit.record(
        {
          action: 'platform.plan_updated',
          actorUserId: auth.userId,
          entityType: 'plan',
          entityId: planId,
          before: toPlanView(before) as unknown as Prisma.InputJsonObject,
          after: {
            ...dto,
            features: dto.features?.map((f) => ({ ...f })),
          } as Prisma.InputJsonObject,
          client,
        },
        tx,
      );
    });
    return this.get(planId);
  }

  async get(planId: string): Promise<PlanView> {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      include: { features: true },
    });
    if (!plan) throw notFound();
    return toPlanView(plan);
  }

  async getSettings(): Promise<BillingSettingsView> {
    const s = await this.subscriptions.settings();
    return {
      trialDays: s.trialDays,
      reminderDaysBefore: s.reminderDaysBefore,
      paymentInstructions: s.paymentInstructions,
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  /** A new trial length applies to shops created after the change. */
  async updateSettings(
    auth: AuthContext,
    input: BillingSettingsInput,
    client: ClientInfo,
  ): Promise<BillingSettingsView> {
    const instructions = input.paymentInstructions?.trim() || null;
    await this.prisma.$transaction(async (tx) => {
      const before = await this.subscriptions.settings(tx);
      const data = {
        trialDays: input.trialDays,
        reminderDaysBefore: input.reminderDaysBefore,
        paymentInstructions: instructions,
      };
      await tx.billingSettings.upsert({
        where: { id: 1 },
        create: { id: 1, ...data },
        update: data,
      });
      await this.audit.record(
        {
          action: 'platform.billing_settings_updated',
          actorUserId: auth.userId,
          entityType: 'billing_settings',
          before: {
            trialDays: before.trialDays,
            reminderDaysBefore: before.reminderDaysBefore,
            paymentInstructions: before.paymentInstructions,
          },
          after: data,
          client,
        },
        tx,
      );
    });
    return this.getSettings();
  }
}
