"use client";

import { useState } from "react";
import { EtfCreatorEditor, type CreatorSeed, type EtfCreatorProps } from "./etf-creator-editor";
import { EtfCreatorSubsets } from "./etf-creator-subsets";

export function EtfCreator(props: EtfCreatorProps) {
  const [seed, setSeed] = useState<CreatorSeed | null>(null);
  return seed
    ? <EtfCreatorSubsets {...props} seed={seed} onNewSingle={() => setSeed(null)} />
    : <EtfCreatorEditor {...props} onUseSubsets={setSeed} onLoadComposite={(detail) => setSeed({
      subsets: detail.criteria.subsets!, ticker: detail.etf.ticker, name: detail.etf.name,
      description: detail.editableDescription, visibility: detail.etf.visibility ?? "weights", editingEtfId: detail.etf.id,
    })} />;
}
