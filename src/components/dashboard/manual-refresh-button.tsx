import { adrPremiumStore } from "./adr-premium-store";

interface ManualRefreshButtonProps {
  disabled?: boolean;
  loading: boolean;
  onRefresh: () => void;
}

export function ManualRefreshButton({
  disabled = false,
  loading,
  onRefresh,
}: ManualRefreshButtonProps) {
  return (
    <button
      className="manual-refresh-button"
      type="button"
      disabled={disabled || loading}
      aria-label="Force refresh data"
      title="Bypass the server cache and request fresh provider data"
      onClick={() => {
        // Start before the parent replaces its rows and unmounts their badges.
        void adrPremiumStore.refreshIfLoaded();
        onRefresh();
      }}
    >
      <span className={loading ? "is-refreshing" : ""} aria-hidden="true">
        ↻
      </span>
      {loading ? "Refreshing…" : "Force refresh"}
    </button>
  );
}
