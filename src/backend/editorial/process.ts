import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { Database } from "../database/client";
import { events, eventSources, eventVersions, sourceItems, sources } from "../database/schema";
import { classify, dedupKey, isVerifiedPrimary, normalizedText, semanticHash } from "./classify";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Selection = { sourceId: string; externalIds: string[] };

async function evidenceFor(tx: Transaction, eventId: string) {
  return tx
    .select({ item: sourceItems, source: sources, link: eventSources })
    .from(eventSources)
    .innerJoin(sourceItems, eq(sourceItems.id, eventSources.sourceItemId))
    .innerJoin(sources, eq(sources.id, sourceItems.sourceId))
    .where(and(eq(eventSources.eventId, eventId), ne(sourceItems.processingState, "removed")))
    .orderBy(asc(sourceItems.collectedAt), asc(sourceItems.id));
}

function representativeFor(linked: Awaited<ReturnType<typeof evidenceFor>>) {
  return linked.find(({ item, source }) => isVerifiedPrimary(source, item)) ?? linked[0];
}

function snapshot(event: typeof events.$inferSelect, links: (typeof eventSources.$inferSelect)[]) {
  return {
    title: normalizedText(event.title),
    category: event.category,
    companies: event.companies,
    products: event.products,
    version: event.version,
    type: event.type,
    editorialStatus: event.editorialStatus,
    publishedAt: event.publishedAt?.toISOString() ?? null,
    evidence: [...links]
      .sort((a, b) => a.sourceItemId.localeCompare(b.sourceItemId))
      .map((link) => ({
        id: link.sourceItemId,
        role: link.role,
        url: link.evidenceUrl,
        title: normalizedText(link.claim),
      })),
  };
}

export async function processPendingInTransaction(
  tx: Transaction,
  selection?: Selection,
  limit = 100,
): Promise<number> {
  if (selection && !selection.externalIds.length) return 0;
  const pending = await tx
    .select({ item: sourceItems, source: sources })
    .from(sourceItems)
    .innerJoin(sources, eq(sources.id, sourceItems.sourceId))
    .where(
      and(
        eq(sourceItems.processingState, "pending"),
        selection
          ? and(
              eq(sourceItems.sourceId, selection.sourceId),
              inArray(sourceItems.externalId, selection.externalIds),
            )
          : undefined,
      ),
    )
    .orderBy(asc(sourceItems.collectedAt), asc(sourceItems.id))
    .limit(limit)
    .for("update", { of: sourceItems, skipLocked: true });

  for (const { item, source } of pending) {
    const classification = classify(item, source);
    const [existingLink] = await tx
      .select()
      .from(eventSources)
      .where(eq(eventSources.sourceItemId, item.id))
      .limit(1);
    const key = dedupKey(item);
    let identityChange: ReturnType<typeof snapshot> | undefined;
    let previousEvent: typeof events.$inferSelect | undefined;
    if (existingLink) {
      [previousEvent] = await tx
        .select()
        .from(events)
        .where(eq(events.id, existingLink.eventId))
        .for("update");
      if (previousEvent && previousEvent.dedupKey !== key) {
        const oldLinks = await tx
          .select()
          .from(eventSources)
          .where(eq(eventSources.eventId, previousEvent.id));
        identityChange = snapshot(previousEvent, oldLinks);
        await tx.insert(eventVersions).values({
          eventId: previousEvent.id,
          previousContent: identityChange,
          contentHash: semanticHash(identityChange),
          rationale:
            "A fonte alterou a URL canônica ou versão. A evidência foi transferida para o evento correspondente à nova identidade.",
        });
        await tx
          .delete(eventSources)
          .where(
            and(eq(eventSources.eventId, previousEvent.id), eq(eventSources.sourceItemId, item.id)),
          );
        const remaining = representativeFor(await evidenceFor(tx, previousEvent.id));
        await tx
          .update(events)
          .set({
            ...(remaining
              ? {
                  ...classify(remaining.item, remaining.source),
                  publishedAt: remaining.item.publishedAt,
                }
              : {}),
            lastChangedAt: new Date(),
          })
          .where(eq(events.id, previousEvent.id));
      }
    }
    if (!existingLink || identityChange) {
      await tx
        .insert(events)
        .values({
          ...classification,
          dedupKey: key,
          summary: null,
          impact: null,
          firstDiscoveredAt: previousEvent?.firstDiscoveredAt ?? item.collectedAt,
          lastChangedAt: item.collectedAt,
          publishedAt: item.publishedAt,
          sortAt: previousEvent?.sortAt ?? item.publishedAt ?? item.collectedAt,
        })
        .onConflictDoNothing({ target: events.dedupKey });
    }
    const [event] = await tx
      .select()
      .from(events)
      .where(
        existingLink && !identityChange
          ? eq(events.id, existingLink.eventId)
          : eq(events.dedupKey, key),
      )
      .for("update");
    if (!event) throw new Error("Evento editorial não encontrado após persistência.");

    const beforeLinks = await tx
      .select()
      .from(eventSources)
      .where(eq(eventSources.eventId, event.id))
      .orderBy(asc(eventSources.sourceItemId));
    const before = snapshot(event, beforeLinks);
    const primary = isVerifiedPrimary(source, item);
    await tx
      .insert(eventSources)
      .values({
        eventId: event.id,
        sourceItemId: item.id,
        role: primary ? "primary" : "discovery",
        evidenceUrl: item.originalUrl,
        claim: normalizedText(item.title),
      })
      .onConflictDoUpdate({
        target: [eventSources.eventId, eventSources.sourceItemId],
        set: {
          role: primary ? "primary" : "discovery",
          evidenceUrl: item.originalUrl,
          claim: normalizedText(item.title),
        },
      });

    const linked = await evidenceFor(tx, event.id);
    const representative = representativeFor(linked);
    if (!representative) throw new Error("Evento sem evidência utilizável.");
    const next = classify(representative.item, representative.source);
    const publication = isVerifiedPrimary(representative.source, representative.item)
      ? representative.item.publishedAt
      : (event.publishedAt ?? representative.item.publishedAt);
    const after = snapshot(
      { ...event, ...next, publishedAt: publication },
      linked.map(({ link }) => link),
    );
    const changed = semanticHash(before) !== semanticHash(after);
    if (beforeLinks.length && changed) {
      await tx.insert(eventVersions).values({
        eventId: event.id,
        previousContent: before,
        contentHash: semanticHash(before),
        rationale:
          primary && event.editorialStatus !== "official_announcement"
            ? "Fonte primária verificada adicionada à cobertura."
            : existingLink
              ? "Metadados ou evidência da fonte foram alterados."
              : "Nova cobertura vinculada à mesma URL e versão.",
      });
    }
    if (identityChange)
      await tx.insert(eventVersions).values({
        eventId: event.id,
        previousContent: identityChange,
        contentHash: semanticHash(identityChange),
        rationale:
          "Evidência transferida de evento cuja URL canônica ou versão foi alterada pela fonte. A descoberta original foi preservada.",
      });
    await tx
      .update(events)
      .set({
        ...next,
        publishedAt: publication,
        firstDiscoveredAt: new Date(
          Math.min(
            event.firstDiscoveredAt.getTime(),
            ...linked.map(({ item: evidence }) => evidence.collectedAt.getTime()),
          ),
        ),
        ...(identityChange || (changed && beforeLinks.length) ? { lastChangedAt: new Date() } : {}),
      })
      .where(eq(events.id, event.id));
    await tx
      .update(sourceItems)
      .set({ processingState: "processed" })
      .where(eq(sourceItems.id, item.id));
  }
  return pending.length;
}

export async function processPendingItems(db: Database, limit = 100): Promise<number> {
  return db.transaction((tx) => processPendingInTransaction(tx, undefined, limit));
}
