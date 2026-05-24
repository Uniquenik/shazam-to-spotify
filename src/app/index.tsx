import { QueryClientProvider } from "./providers/query-client";
import { HomePage } from "../pages/home/ui/home-page";

export function App() {
  return (
    <QueryClientProvider>
      <HomePage />
    </QueryClientProvider>
  );
}
