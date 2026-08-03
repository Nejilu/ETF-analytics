export interface EtfReferenceResolution {
  id: string;
}

export function reorderEtfItems<T extends { etfId: string }>(
  items: readonly T[],
  orderedIds: readonly string[],
): T[] {
  const byId = new Map(items.map((item) => [item.etfId, item]));
  return orderedIds.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

export function canonicalizeEtfReferences(
  references: readonly string[],
  resolve: (reference: string) => EtfReferenceResolution | undefined,
): string[] {
  const distinctReferences = [...new Set(references
    .map((reference) => reference.trim())
    .filter(Boolean))];
  return [...new Set(distinctReferences.map((reference) => resolve(reference)?.id ?? reference))];
}
