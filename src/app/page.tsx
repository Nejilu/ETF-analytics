import { ComparisonWorkbench } from "@/components/dashboard/comparison-workbench";
import { getCatalog } from "@/data/services/catalog-service";

export default function HomePage() {
  return <ComparisonWorkbench catalog={getCatalog()} />;
}
