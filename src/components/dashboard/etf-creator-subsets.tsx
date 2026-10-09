"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HoldingsSnapshot } from "@/domain/etf";
import { combineCreatorSubsets, defaultCreatorCriteria, deriveDynamicCreatorHoldings, hasCreatorOverlapMultipliers, type CreatorSubset } from "@/domain/etf-creator";
import type { LocalCustomEtfDetail } from "@/domain/local-etf";
import type { EtfVisibility } from "@/domain/visibility";
import { EtfCreatorEditor, type CreatorSeed, type EtfCreatorProps, type SubsetEditorUpdate } from "./etf-creator-editor";
import { VisibilitySelect } from "./visibility-select";

function AllocationInput({ value, name, onChange, onValidityChange }: {
  value: number; name: string; onChange: (value: number) => void; onValidityChange: (valid: boolean) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(value);
  const parse = (text: string) => {
    const number = Number(text.replace(",", "."));
    return text.trim() !== "" && /^\d*(?:[.,]\d*)?$/.test(text) && Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
  };
  return <label className="creator-subset-allocation">
    <input type="text" inputMode="decimal" aria-label={`${name} allocation percentage`} aria-invalid={parse(text) === null} value={text}
      onChange={(event) => { const next = event.target.value; setDraft(next); const number = parse(next); onValidityChange(number !== null); if (number !== null) onChange(number); }}
      onBlur={() => { setDraft(null); onValidityChange(true); }} />
    <span>%</span>
  </label>;
}

export function EtfCreatorSubsets({ seed, onNewSingle, ...props }: EtfCreatorProps & { seed: CreatorSeed; onNewSingle: () => void }) {
  const [subsets, setSubsets] = useState(seed.subsets);
  const [activeId, setActiveId] = useState(seed.subsets[0].id);
  const [autoSelectIds, setAutoSelectIds] = useState<Set<string>>(() => new Set());
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [readyById, setReadyById] = useState<Record<string, boolean>>({});
  const [invalidAllocations, setInvalidAllocations] = useState<Set<string>>(() => new Set());
  const [snapshots, setSnapshots] = useState<Map<string, HoldingsSnapshot>>(() => new Map());
  const [refreshNonce, setRefreshNonce] = useState(0);
  const lastAppliedRefresh = useRef(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ticker, setTicker] = useState(seed.ticker);
  const [name, setName] = useState(seed.name);
  const [description, setDescription] = useState(seed.description);
  const [visibility, setVisibility] = useState<EtfVisibility>(seed.visibility);
  const [editingEtfId, setEditingEtfId] = useState(seed.editingEtfId ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [query, setQuery] = useState("");
  const customEtfs = props.catalog.flatMap((group) => group.variants).filter((etf) => etf.fundType === "custom");
  const active = subsets.find((subset) => subset.id === activeId) ?? subsets[0];
  const dependencyKey = JSON.stringify([...new Set(subsets.filter((subset) => subset.allocationWeight > 0).flatMap((subset) => [
    subset.sourceEtfId,
    ...(hasCreatorOverlapMultipliers(subset.criteria.weightMultipliers) && subset.criteria.overlapEtfId ? [subset.criteria.overlapEtfId] : []),
  ]))].sort());

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) { setLoading(true); setLoadError(null); } });
    void Promise.all((JSON.parse(dependencyKey) as string[]).map(async (id) => {
      const response = await fetch(`/api/v1/holdings/${encodeURIComponent(id)}${refreshNonce ? "?refresh=true" : ""}`, { cache: "no-store", signal: controller.signal });
      const payload = await response.json() as { data?: HoldingsSnapshot; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error ?? "A subset source is unavailable.");
      return payload.data;
    })).then((loaded) => {
      if (!controller.signal.aborted) {
        setSnapshots((current) => new Map([...current, ...loaded.map((snapshot) => [snapshot.etf.id, snapshot] as const)]));
        if (refreshNonce > lastAppliedRefresh.current) {
          lastAppliedRefresh.current = refreshNonce;
          setEditorGeneration((value) => value + 1);
          setReadyById({});
        }
      }
    }).catch((reason) => { if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : "Subset data is unavailable."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [dependencyKey, refreshNonce]);

  const onEditorChange = useCallback((id: string, update: SubsetEditorUpdate) => {
    setSubsets((current) => {
      const index = current.findIndex((subset) => subset.id === id);
      if (index < 0) return current;
      const next = { ...current[index], sourceEtfId: update.sourceEtfId, criteria: update.criteria, selectedSecurities: update.selectedSecurities };
      if (JSON.stringify(next) === JSON.stringify(current[index])) return current;
      return current.map((subset, position) => position === index ? next : subset);
    });
    setReadyById((current) => current[id] === update.ready ? current : { ...current, [id]: update.ready });
    setSnapshots((current) => {
      const newer = update.snapshots.filter((snapshot) => current.get(snapshot.etf.id) !== snapshot &&
        (!current.has(snapshot.etf.id) || snapshot.fetchedAt >= current.get(snapshot.etf.id)!.fetchedAt));
      return newer.length ? new Map([...current, ...newer.map((snapshot) => [snapshot.etf.id, snapshot] as const)]) : current;
    });
    if (update.ready) setAutoSelectIds((current) => { if (!current.has(id)) return current; const next = new Set(current); next.delete(id); return next; });
    setSaved(null);
  }, [setSubsets, setReadyById, setSnapshots, setAutoSelectIds, setSaved]);

  const parts = useMemo(() => subsets.map((subset) => {
    const source = snapshots.get(subset.sourceEtfId);
    const overlap = snapshots.get(subset.criteria.overlapEtfId ?? "");
    const needsOverlap = hasCreatorOverlapMultipliers(subset.criteria.weightMultipliers);
    const ready = Boolean(source) && (!needsOverlap || Boolean(overlap));
    const derived = deriveDynamicCreatorHoldings(source?.holdings.filter((holding) => holding.assetClass === "Equity") ?? [], subset.selectedSecurities,
      subset.criteria.weightingMode, subset.criteria.weightMultipliers, new Set(overlap?.holdings.map((holding) => holding.securityId) ?? []));
    return { ...subset, ...derived, ready };
  }), [subsets, snapshots]);
  const final = useMemo(() => combineCreatorSubsets(parts), [parts]);
  const totalValid = Math.abs(final.allocationTotal - 100) <= 1e-6;
  const allReady = parts.every((part) => part.allocationWeight <= 0 || part.ready);
  const canSave = totalValid && allReady && !loading && !loadError && readyById[active.id] && invalidAllocations.size === 0 && final.emptySubsetNames.length === 0 && final.holdings.length > 0 && subsets.every((subset) => subset.name.trim());
  const updateSubset = (id: string, update: Partial<CreatorSubset>) => { setSubsets((current) => current.map((subset) => subset.id === id ? { ...subset, ...update } : subset)); setSaved(null); };
  const selectSubset = (id: string) => { setActiveId(id); setReadyById((current) => ({ ...current, [id]: false })); };
  const addSubset = () => {
    const sourceEtfId = active.sourceEtfId;
    const source = snapshots.get(sourceEtfId);
    const subset: CreatorSubset = { id: crypto.randomUUID(), name: `Subset ${subsets.length + 1}`, allocationWeight: 0, sourceEtfId, criteria: defaultCreatorCriteria(),
      selectedSecurities: source?.holdings.filter((holding) => holding.assetClass === "Equity").map(({ securityId, ticker }) => ({ securityId, ticker })) ?? [] };
    if (!source) setAutoSelectIds((current) => new Set([...current, subset.id]));
    setSubsets((current) => [...current, subset]); setActiveId(subset.id); setSaved(null);
  };
  const loadDefinition = async (id: string) => {
    setSaving(true); setError(null); setSaved(null);
    try {
      const response = await fetch(`/api/v1/local-etfs/${encodeURIComponent(id)}`, { cache: "no-store" });
      const payload = await response.json() as { data?: LocalCustomEtfDetail; error?: string };
      if (!response.ok || !payload.data || payload.data.kind !== "custom") throw new Error(payload.error ?? "The ETF definition is unavailable.");
      const detail = payload.data;
      const definitions = detail.criteria.subsets ?? [{ id: crypto.randomUUID(), name: "Subset 1", allocationWeight: 100, sourceEtfId: detail.sourceEtfId, criteria: detail.criteria,
        selectedSecurities: detail.selectedSecurityIds.map((securityId) => ({ securityId, ticker: detail.holdings.find((holding) => holding.securityId === securityId)?.ticker ?? "—" })) }];
      setSubsets(definitions); setActiveId(definitions[0].id); setReadyById({}); setInvalidAllocations(new Set()); setAutoSelectIds(new Set()); setEditorGeneration((value) => value + 1);
      setEditingEtfId(id); setTicker(detail.etf.ticker); setName(detail.etf.name); setDescription(detail.editableDescription); setVisibility(detail.etf.visibility ?? "weights"); setConfirmDelete(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The ETF could not be loaded."); }
    finally { setSaving(false); }
  };
  const save = async () => {
    if (!canSave) return;
    setSaving(true); setError(null); setSaved(null);
    try {
      const isEditing = Boolean(editingEtfId);
      const criteria = { ...defaultCreatorCriteria(), subsets };
      const response = await fetch(isEditing ? `/api/v1/local-etfs/${encodeURIComponent(editingEtfId)}` : "/api/v1/etf-creator", {
        method: isEditing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, name, description, visibility, sourceEtfId: subsets.find((subset) => subset.allocationWeight > 0)!.sourceEtfId,
          selectedSecurityIds: final.holdings.map((holding) => holding.securityId), criteria, ...(isEditing ? { kind: "custom" } : {}) }),
      });
      const payload = await response.json() as { data?: { id: string; ticker: string }; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error ?? "The ETF could not be saved.");
      setEditingEtfId(payload.data.id); await props.onCatalogChanged(); setSaved(`${payload.data.ticker} ${isEditing ? "updated" : "saved"} with ${subsets.length} allocated subsets.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The ETF could not be saved."); }
    finally { setSaving(false); }
  };
  const deleteEtf = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setSaving(true);
    try {
      const response = await fetch(`/api/v1/local-etfs/${encodeURIComponent(editingEtfId)}`, { method: "DELETE" });
      if (!response.ok) { const payload = await response.json() as { error?: string }; throw new Error(payload.error ?? "The ETF could not be deleted."); }
      await props.onCatalogChanged(); onNewSingle();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The ETF could not be deleted."); }
    finally { setSaving(false); }
  };
  const visible = final.holdings.filter((holding) => `${holding.ticker} ${holding.name}`.toLowerCase().includes(query.trim().toLowerCase()));
  const formatWeight = (weight: number) => `${weight.toFixed(3)}%`;
  const contributionIndex = useMemo(() => {
    const index = new Map<string, { name: string; weight: number }[]>();
    for (const part of parts) {
      if (part.allocationWeight <= 0) continue;
      for (const holding of part.holdings) index.set(holding.securityId, [...(index.get(holding.securityId) ?? []), { name: part.name, weight: holding.weight * part.allocationWeight / 100 }]);
    }
    return index;
  }, [parts]);

  return <fieldset className="creator-workspace creator-subsets-workspace" id="etf-creator" disabled={saving}>
    <section className="panel local-etf-workflow-switcher">
      <div><span className="eyebrow">ETF definition · allocated subsets</span><h2>{editingEtfId ? "Edit an existing ETF" : "Create a new ETF"}</h2><p>Each subset owns its allocation, source, selection rules and weighting method.</p></div>
      <div className="local-etf-workflow-controls">
        <button type="button" disabled={saving} onClick={onNewSingle}>New single ETF</button>
        {customEtfs.length ? <label className="local-etf-picker"><span>Edit custom ETF</span><select aria-label="Edit custom ETF" value={editingEtfId} disabled={saving} onChange={(event) => { if (event.target.value) void loadDefinition(event.target.value); }}><option value="">Choose ETF</option>{customEtfs.map((etf) => <option key={etf.id} value={etf.id}>{etf.ticker} · {etf.name}</option>)}</select></label> : null}
        {editingEtfId ? <button type="button" disabled={saving} onClick={() => void deleteEtf()}>{confirmDelete ? "Confirm delete ETF" : "Delete ETF"}</button> : null}
        {confirmDelete ? <button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button> : null}
      </div>
    </section>
    <section className="panel creator-subsets-plan">
      <div className="panel-heading"><div><span className="eyebrow">ETF Creator</span><h1>Allocated subsets</h1><p>Add as many subsets as needed. Allocate 100% of the ETF, then configure each subset independently. Shared securities receive the sum of their contributions.</p></div><button type="button" className="primary-button" disabled={saving} onClick={addSubset}>+ Add subset</button></div>
      <div className="creator-allocation-status" aria-live="polite"><strong>{final.allocationTotal.toFixed(2)}% allocated</strong><span>{totalValid ? "Target allocation complete" : final.allocationTotal < 100 ? `${(100 - final.allocationTotal).toFixed(2)}% remaining` : `${(final.allocationTotal - 100).toFixed(2)}% over target`}</span></div>
      <div className="creator-allocation-bar" aria-label="Subset allocations">{subsets.map((subset, index) => <span key={subset.id} title={`${subset.name}: ${subset.allocationWeight}%`} style={{ flexGrow: subset.allocationWeight, backgroundColor: ["var(--mint)", "var(--purple)", "var(--coral)"][index % 3] }} />)}</div>
      <div className="creator-subset-list">{subsets.map((subset) => {
        const part = parts.find((part) => part.id === subset.id)!;
        return <div className={`creator-subset-card${active.id === subset.id ? " is-active" : ""}`} key={subset.id}>
          <button type="button" className="creator-subset-select" aria-pressed={active.id === subset.id} aria-label={`Configure ${subset.name}`} disabled={saving} onClick={() => selectSubset(subset.id)}><strong>{subset.name}</strong><small>{part.selectedSecurities.length} selected · {subset.criteria.weightingMode === "equal" ? "Equal base" : "Free float base"}</small></button>
          <AllocationInput name={subset.name} value={subset.allocationWeight} onChange={(allocationWeight) => updateSubset(subset.id, { allocationWeight })} onValidityChange={(valid) => setInvalidAllocations((current) => { const next = new Set(current); if (valid) next.delete(subset.id); else next.add(subset.id); return next; })} />
          <button type="button" aria-label={`Duplicate ${subset.name}`} disabled={saving} onClick={() => { const copy = { ...structuredClone(subset), id: crypto.randomUUID(), name: `${subset.name.slice(0, 70)} copy`, allocationWeight: 0 }; setSubsets((current) => [...current, copy]); setActiveId(copy.id); setSaved(null); }}>Duplicate</button>
          <button type="button" aria-label={`Remove ${subset.name}`} disabled={saving || subsets.length === 1} onClick={() => { const remaining = subsets.filter((candidate) => candidate.id !== subset.id); setSubsets(remaining); if (active.id === subset.id) selectSubset(remaining[0].id); setSaved(null); }}>Remove</button>
        </div>;
      })}</div>
      {invalidAllocations.size ? <p className="alert alert--error" role="alert">Use allocation percentages from 0 to 100. Decimals with a point or comma are accepted.</p> : null}
    </section>
    <section className="panel creator-active-subset"><label className="field"><span>Subset name</span><input aria-label="Subset name" value={active.name} maxLength={80} disabled={saving} onChange={(event) => updateSubset(active.id, { name: event.target.value })} /></label><p>Configure <strong>{active.name}</strong> · target <strong>{active.allocationWeight}% of the final ETF</strong>. Weights inside the editor below total 100% of this subset.</p></section>
    <div className="creator-subset-editor" aria-label={`Rules for ${active.name}`}>
      <EtfCreatorEditor key={`${editorGeneration}:${active.id}`} {...props} catalog={props.catalog.map((group) => ({ ...group, variants: group.variants.filter((etf) => etf.id !== editingEtfId) })).filter((group) => group.variants.length)} subsetEditor={{ definition: active, editingEtfId, autoSelect: autoSelectIds.has(active.id), onChange: onEditorChange }} />
    </div>
    <section className="panel creator-final-composition">
      <div className="panel-heading"><div><span className="eyebrow">Combined ETF preview</span><h2>Final composition</h2><p>{subsets.length} subsets · {final.holdings.length} unique securities · {final.allocationTotal.toFixed(2)}% target allocation</p></div><button type="button" disabled={loading || saving} onClick={() => setRefreshNonce((value) => value + 1)}>{loading ? "Loading…" : "Refresh all subsets"}</button></div>
      {!totalValid ? <p className="alert" role="status">Allocate exactly 100% before saving. The preview shows contributions at the percentages entered.</p> : null}
      {final.emptySubsetNames.length ? <p className="alert alert--error" role="alert">These allocated subsets need at least one positive security weight: {final.emptySubsetNames.join(", ")}.</p> : null}
      {loadError || error ? <p className="alert alert--error" role="alert">{error ?? loadError}</p> : null}
      <label className="field"><span>Search final constituents</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="creator-final-table"><table><thead><tr><th>Security</th><th>Subset contributions</th><th>Final ETF weight</th></tr></thead><tbody>{visible.slice(0, 250).map((holding) => <tr key={holding.securityId}><td><strong>{holding.ticker}</strong><small>{holding.name}</small></td><td>{contributionIndex.get(holding.securityId)?.map((part) => `${part.name}: ${formatWeight(part.weight)}`).join(" · ")}</td><td>{formatWeight(holding.weight)}</td></tr>)}</tbody></table></div>
      {visible.length > 250 ? <p className="creator-table-note">Showing the first 250 securities. Use search for another constituent.</p> : null}
    </section>
    <section className="panel creator-save-panel">
      <div><span className="eyebrow">Save the complete definition</span><h2>{editingEtfId ? "Update this ETF" : "Save to supported ETFs"}</h2><p>Subset allocations and all individual rules are saved. Each subset is reweighted from its current source data on every read, then its target percentage is applied to the final ETF.</p></div>
      <div className="creator-save-fields"><label className="field"><span>Ticker</span><input value={ticker} maxLength={10} onChange={(event) => { setTicker(event.target.value.toUpperCase()); setSaved(null); }} /></label><label className="field"><span>ETF name</span><input value={name} maxLength={80} onChange={(event) => { setName(event.target.value); setSaved(null); }} /></label>
        {props.publicationEnabled ? <VisibilitySelect value={visibility} onChange={setVisibility} etfId={editingEtfId || undefined} onSaved={props.onCatalogChanged} disabled={saving} /> : null}
        <label className="field creator-description-field"><span>Description (optional)</span><textarea value={description} maxLength={240} onChange={(event) => { setDescription(event.target.value); setSaved(null); }} /></label></div>
      <button type="button" className="primary-button creator-save-button" disabled={saving || !canSave} onClick={() => void save()}>{saving ? "Saving ETF…" : editingEtfId ? "Update custom ETF" : "Save custom ETF"}</button>
      {saved ? <p className="saved-etf-success">{saved}</p> : null}
    </section>
  </fieldset>;
}
