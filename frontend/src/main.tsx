import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ClientProvider } from '@solana/react';
import { App } from './App';
import { api, validateDeployment } from './lib/api/client';
import { createAppClient } from './lib/chain/client';
import './styles.css';

const element = document.getElementById('root');
if (!element) throw new Error('Application root is missing');
const root = createRoot(element);
root.render(
  <main className="startup" role="status">
    Connecting to Volaryn…
  </main>,
);

async function start() {
  try {
    const result = await api.GET('/api/config');
    if (!result.data)
      throw new Error('The application is not ready. Check the services and try again.');
    const deployment = validateDeployment(result.data, import.meta.env.MODE);
    if (import.meta.env.MODE === 'localnet') {
      const { registerDemoWallet } = await import('./localnet/wallet');
      await registerDemoWallet(deployment);
    }
    const client = await createAppClient(deployment);
    await client.wallet.whenReady();
    root.render(
      <StrictMode>
        <ClientProvider client={client}>
          <BrowserRouter>
            <App deployment={deployment} />
          </BrowserRouter>
        </ClientProvider>
      </StrictMode>,
    );
  } catch (error) {
    root.render(
      <main className="startup" role="alert">
        <h1>Unable to open this deployment</h1>
        <p>{error instanceof Error ? error.message : 'Connection failed'}</p>
        <button
          onClick={() => {
            void start();
          }}
        >
          Try again
        </button>
      </main>,
    );
  }
}
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const notice = document.createElement('p');
  notice.className = 'updateNotice';
  notice.setAttribute('role', 'alert');
  notice.textContent =
    'A new application version is available. Refresh when wallet approval is complete; pending transaction identifiers are preserved.';
  document.body.prepend(notice);
});
void start();
