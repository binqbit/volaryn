import { createContext, useContext, useState, type ReactNode } from 'react';
import { WalletDialog } from './WalletDialog';

const OpenWalletDialog = createContext<(() => void) | null>(null);

export function WalletConnectionProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <OpenWalletDialog value={() => setOpen(true)}>
      {children}
      {open && <WalletDialog onClose={() => setOpen(false)} />}
    </OpenWalletDialog>
  );
}

export function ConnectWalletButton({
  className,
  children = 'Connect wallet',
}: {
  className?: string;
  children?: ReactNode;
}) {
  const open = useContext(OpenWalletDialog);
  if (!open) throw new Error('Wallet connection provider is missing');
  return (
    <button type="button" className={className} onClick={open}>
      {children}
    </button>
  );
}
