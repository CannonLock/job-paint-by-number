// Registers the Chart.js primitives used across the analyzer charts. Imported
// once from the client orchestrator so tree-shaking keeps the bundle lean.
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  Tooltip,
  Legend,
  Title,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  Tooltip,
  Legend,
  Title,
);
