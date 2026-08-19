import { Buffer } from "buffer";

if (typeof window !== "undefined") {
  (globalThis as any).Buffer = (globalThis as any).Buffer ?? Buffer;
  (window as any).Buffer = (window as any).Buffer ?? Buffer;
  (globalThis as any).global = (globalThis as any).global ?? globalThis;
  (window as any).global = (window as any).global ?? window;
}

async function bootstrap() {
  const React = (await import("react")).default;
  const ReactDOM = await import("react-dom/client");
  const { WalletProvider } = await import("@txnlab/use-wallet-react");
  const { walletManager } = await import("./lib/wallet");
  const App = (await import("./App")).default;
  await import("./index.css");
  const root = document.getElementById("root");
  if (!root) throw new Error("Root element #root was not found");
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <WalletProvider manager={walletManager}>
        <App />
      </WalletProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
