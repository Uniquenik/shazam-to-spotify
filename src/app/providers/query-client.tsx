import {
  QueryClient,
  QueryClientProvider as TanstackQueryClientProvider,
} from "@tanstack/react-query";
import { ReactNode, useState } from "react";

type Props = {
  children: ReactNode;
};

export function QueryClientProvider({ children }: Props) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 5_000,
          },
          mutations: {
            retry: false,
          },
        },
      }),
  );

  return (
    <TanstackQueryClientProvider client={client}>
      {children}
    </TanstackQueryClientProvider>
  );
}
