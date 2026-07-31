import "server-only";

import { ensureLocalDatabase } from "@/db/bootstrap";
import { listCatalogGroups } from "@/db/repositories/catalog-repository";
import type { CatalogGroup } from "@/domain/etf";

export function getCatalog(): CatalogGroup[] {
  ensureLocalDatabase();
  return listCatalogGroups();
}
