/**
 * Razorpay — Wire-Shape Mapping
 *
 * Translates a Razorpay JSON entity into the Kizunia-defined shapes in
 * `../types.ts`, and validates it at the boundary. That is all this file does.
 *
 * What it is NOT: a state mapping. It never turns a provider status into a
 * Kizunia `SubscriptionPhase`, never applies the trial-conversion rule, never
 * resolves a provider plan through the catalog, and never compares `notes` with
 * a local record. Those are the sync apply path's job (Phase IV,
 * `policy/state-mapping.ts`). The provider status is carried through
 * untouched, as `rawStatus`, so the layers stay distinct: provider status,
 * Kizunia phase, and effective contribution are never conflated
 * (docs/architecture/subscription/implementation/state-model.md).
 *
 * Validation, so a bad response is `MALFORMED` and never a guess:
 *
 *  - `id`, `plan_id` and `status` must be present, and the status one of the
 *    nine Razorpay documents (plus `paused`, which the API returns although the
 *    entity page omits it). An unknown status is not a state to invent.
 *  - A documented field of the wrong type is malformed.
 *  - The undocumented fields the API also returns (`payment_method`,
 *    `halted_at`, D3) are read defensively: useful, never depended on, so a
 *    surprise there reads as `null` and never fails a response.
 *
 * Timestamps arrive as epoch seconds and leave as `Date`.
 */
import type { ListPage, PaymentMethodInfo, ProviderSubscriptionState } from "../types";

export type MappingResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/** The statuses Razorpay documents for a subscription (`paused` is returned by the API, if omitted from the entity page). */
const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  "created",
  "authenticated",
  "active",
  "pending",
  "halted",
  "paused",
  "cancelled",
  "completed",
  "expired",
]);

type Entity = Record<string, unknown>;

/** Thrown inside this file only, and always caught by a public function. */
class MalformedEntity extends Error {}

function asEntity(value: unknown, what: string): Entity {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MalformedEntity(`${what} is not an object`);
  }

  return value as Entity;
}

function requiredString(entity: Entity, key: string): string {
  const value = entity[key];

  if (typeof value !== "string" || value === "") throw new MalformedEntity(`missing or invalid ${key}`);

  return value;
}

function optionalString(entity: Entity, key: string): string | null {
  const value = entity[key];

  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new MalformedEntity(`invalid ${key}`);

  return value === "" ? null : value;
}

function epochToDate(value: number): Date {
  return new Date(value * 1000);
}

function optionalEpoch(entity: Entity, key: string): Date | null {
  const value = entity[key];

  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new MalformedEntity(`invalid ${key}`);
  }

  return epochToDate(value);
}

function optionalBoolean(entity: Entity, key: string): boolean {
  const value = entity[key];

  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") throw new MalformedEntity(`invalid ${key}`);

  return value;
}

function optionalInteger(entity: Entity, key: string): number | null {
  const value = entity[key];

  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new MalformedEntity(`invalid ${key}`);

  return value;
}

/**
 * The provider returns an empty `notes` as `[]` rather than `{}`, and a value
 * that is not a string has no place in the identifiers Kizunia sends.
 */
function readNotes(entity: Entity): Readonly<Record<string, string>> {
  const value = entity.notes;

  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Entity).filter((pair): pair is [string, string] => typeof pair[1] === "string"),
  );
}

function mapSubscription(raw: unknown): ProviderSubscriptionState {
  const entity = asEntity(raw, "subscription");
  const rawStatus = requiredString(entity, "status");

  if (!KNOWN_STATUSES.has(rawStatus)) {
    throw new MalformedEntity(`unrecognized subscription status "${rawStatus}"`);
  }

  // Documented as `now` | `cycle_end` on one page and as a timestamp on
  // another, so it is read as a timestamp only when it is one.
  const changeScheduledAt =
    typeof entity.change_scheduled_at === "number" && Number.isFinite(entity.change_scheduled_at)
      ? epochToDate(entity.change_scheduled_at)
      : null;

  // Undocumented (D3): a surprise here reads as null and never fails the response.
  const paymentMethod = typeof entity.payment_method === "string" ? entity.payment_method : null;
  const haltedAt =
    typeof entity.halted_at === "number" && Number.isFinite(entity.halted_at) && entity.halted_at >= 0
      ? epochToDate(entity.halted_at)
      : null;

  return {
    providerSubscriptionId: requiredString(entity, "id"),
    rawStatus,
    providerPlanId: requiredString(entity, "plan_id"),
    currentStart: optionalEpoch(entity, "current_start"),
    currentEnd: optionalEpoch(entity, "current_end"),
    chargeAt: optionalEpoch(entity, "charge_at"),
    startAt: optionalEpoch(entity, "start_at"),
    endAt: optionalEpoch(entity, "end_at"),
    endedAt: optionalEpoch(entity, "ended_at"),
    expireBy: optionalEpoch(entity, "expire_by"),
    hasScheduledChanges: optionalBoolean(entity, "has_scheduled_changes"),
    changeScheduledAt,
    offerId: optionalString(entity, "offer_id"),
    notes: readNotes(entity),
    paidCount: optionalInteger(entity, "paid_count"),
    shortUrl: optionalString(entity, "short_url"),
    paymentMethod,
    haltedAt,
  };
}

function attempt<T>(build: () => T): MappingResult<T> {
  try {
    return { ok: true, value: build() };
  } catch (error) {
    if (error instanceof MalformedEntity) return { ok: false, reason: error.message };

    throw error;
  }
}

/** Maps one subscription entity (a create, fetch, update or cancel response). */
export function mapSubscriptionEntity(body: unknown): MappingResult<ProviderSubscriptionState> {
  return attempt(() => mapSubscription(body));
}

/**
 * Maps a `collection` response. One malformed item makes the whole page
 * malformed: a partial page would look complete, and orphan discovery must
 * never advance past something it could not read.
 */
export function mapSubscriptionCollection(
  body: unknown,
): MappingResult<ListPage<ProviderSubscriptionState>> {
  return attempt(() => {
    const collection = asEntity(body, "collection");

    if (!Array.isArray(collection.items)) throw new MalformedEntity("collection has no items");

    return { items: collection.items.map(mapSubscription) };
  });
}

/**
 * Maps a payment entity to what Kizunia needs from it: the method, and for a
 * card whether it is international (the advisory plan-change capability,
 * SB-LC-07). The subscription entity carries neither.
 */
export function mapPaymentEntity(body: unknown): MappingResult<PaymentMethodInfo> {
  return attempt(() => {
    const entity = asEntity(body, "payment");
    const card = typeof entity.card === "object" && entity.card !== null ? (entity.card as Entity) : null;

    const international =
      typeof entity.international === "boolean"
        ? entity.international
        : typeof card?.international === "boolean"
          ? card.international
          : null;

    return { method: requiredString(entity, "method"), international };
  });
}
