import { ComparisonWorkbench } from "@/components/dashboard/comparison-workbench";
import { ETF_CATALOG } from "@/data/catalog";

export default function HomePage() {
  return <ComparisonWorkbench catalog={ETF_CATALOG} />;
}
