import { ComparisonWorkbench } from "@/components/dashboard/comparison-workbench";
import { ETF_CATALOG } from "@/data/catalog";
import { getSeedSnapshot } from "@/data/seed-holdings";
import { compareHoldings } from "@/domain/processors/compare-holdings";

export default function HomePage() {
  const initialComparison = compareHoldings(
    getSeedSnapshot("IVV"),
    getSeedSnapshot("SWDA"),
  );

  return (
    <ComparisonWorkbench
      catalog={ETF_CATALOG}
      initialComparison={initialComparison}
    />
  );
}
