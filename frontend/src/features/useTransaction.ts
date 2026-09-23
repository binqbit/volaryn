import { useCallback, useEffect, useRef, useState } from 'react';
import { prepareTransaction, submitTransaction } from '@volaryn/protocol';
import { buildAction } from '../lib/chain/buildAction';
import type { ActionRequest, ActionReview } from '../lib/chain/actionTypes';
import type { AppClient } from '../lib/chain/client';
import type { Deployment } from '../lib/api/client';
import { parsePending, type PendingTransaction as Pending } from './pending';
import { observeAction } from './reconcile';
import { clearJournal, journalKey, readJournal, saveJournal, withJournalLock } from './journal';
import { useActivity } from './activity/useActivity';
import { asPending } from './activity/model';
import { readActivity, recoverInterrupted, saveActivity, updateActivity } from './activity/storage';

type Phase =
  | 'idle'
  | 'preparing'
  | 'awaiting-signature'
  | 'not-submitted'
  | Awaited<ReturnType<typeof observeAction>>;
interface Tracking {
  key: string;
  pending: Pending | null;
  phase: Phase;
  error: string;
  unavailable: boolean;
}
const empty: Tracking = { key: '', pending: null, phase: 'idle', error: '', unavailable: false };

export function useTransaction(
  client: AppClient,
  deployment: Deployment,
  owner: string | undefined,
  before?: string,
) {
  const key = owner ? journalKey(deployment.genesisHash, deployment.programId, owner) : '';
  const [tracking, setTracking] = useState(empty);
  const current = tracking.key === key ? tracking : empty;
  const pending = current.pending;
  const lock = useRef(false);
  const activity = useActivity(key, owner, before);

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      if (!owner) {
        setTracking(empty);
        return;
      }
      try {
        const record = readJournal(key, owner);
        if (record && !readActivity(key, owner).some((item) => item.signature === record.signature))
          saveActivity(key, {
            ...record,
            id: record.signature,
            status: 'pending',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            source: 'browser',
          });
        // If another tab still owns the signing lock, its approval remains in progress.
        void withJournalLock(key, async () => recoverInterrupted(key, owner)).catch(() => {});
        if (!cancelled)
          setTracking((previous) => ({
            key,
            pending: record,
            phase: record
              ? 'pending'
              : previous.key === key &&
                  ['finalized', 'failed', 'expired', 'reconciled'].includes(previous.phase)
                ? previous.phase
                : 'idle',
            error: '',
            unavailable: false,
          }));
      } catch (cause) {
        if (!cancelled)
          setTracking({
            ...empty,
            key,
            unavailable: true,
            error:
              cause instanceof Error ? cause.message : 'Saved transaction tracking is unavailable.',
          });
      }
    };
    void restore();
    const changed = (event: StorageEvent) => {
      if (event.key === key || event.key === null) void restore();
    };
    window.addEventListener('storage', changed);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', changed);
    };
  }, [key, owner, deployment.genesisHash]);

  const recoverable = activity.pending.map(asPending).find((item) => item !== null);
  const recoverableSignature = recoverable?.signature;
  const recovery = recoverable ? JSON.stringify(recoverable) : null;
  useEffect(() => {
    if (!owner || !recovery || pending || lock.current || tracking.key !== key) return;
    let cancelled = false;
    void withJournalLock(key, async () => {
      if (cancelled) return;
      const record = readJournal(key, owner) ?? parsePending(recovery);
      saveJournal(key, record);
      if (!readActivity(key, owner).some((item) => item.signature === record.signature))
        saveActivity(key, {
          ...record,
          id: record.signature,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          source: 'browser',
        });
      setTracking((previous) =>
        previous.key === key ? { ...empty, key, pending: record, phase: 'pending' } : previous,
      );
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key, owner, pending, tracking.key, recovery]);

  useEffect(() => {
    if (!pending || !owner) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const phase = await observeAction(client.rpc, pending!);
        if (cancelled) return;
        const complete = ['finalized', 'failed', 'expired', 'reconciled'].includes(phase);
        await withJournalLock(key, async () => {
          updateActivity(key, owner!, pending!.signature, { status: phase });
          if (complete) clearJournal(key, owner!, pending!.signature);
        });
        if (cancelled) return;
        setTracking({
          key,
          pending: complete ? null : pending,
          phase,
          unavailable: false,
          error:
            phase === 'failed'
              ? 'The transaction failed on chain; no partial settlement occurred.'
              : phase === 'expired'
                ? 'The signature expired without completing this action. You may review the current terms and try again.'
                : '',
        });
        if (complete) return;
      } catch {
        if (!cancelled)
          setTracking((previous) =>
            previous.key !== key
              ? previous
              : {
                  ...previous,
                  phase: 'unresolved',
                  error:
                    'Confirmation is unavailable. Reconciling the saved transaction before another submission.',
                },
          );
      }
      if (!cancelled)
        timer = setTimeout(() => {
          void poll();
        }, 1000);
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pending, client, key, owner]);

  const execute = useCallback(
    async (request: ActionRequest, reviewed: ActionReview) => {
      if (!owner || lock.current || current.pending || current.unavailable || tracking.key !== key)
        return;
      lock.current = true;
      const update = (next: Tracking) =>
        setTracking((previous) => (previous.key === key ? next : previous));
      update({ ...empty, key, phase: 'preparing' });
      const attempt = crypto.randomUUID();
      let signed = false;
      try {
        return await withJournalLock(key, async () => {
          const existing = readJournal(key, owner);
          if (existing) {
            update({ ...empty, key, pending: existing, phase: 'pending' });
            return;
          }
          if (!activity.ready || activity.status === 'error' || recoverableSignature)
            throw new Error(
              'Wait for your operation history to refresh before submitting another action.',
            );
          saveActivity(key, {
            id: attempt,
            owner,
            agreement: reviewed.agreement,
            operation: request.operation,
            ...(request.operation === 'create' ? { createdTerms: request.terms } : {}),
            status: 'preparing',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            source: 'browser',
          });
          const connected = client.wallet.getState().connected;
          if (
            !connected?.signer ||
            connected.account.address !== owner ||
            !connected.supportedTransactionVersions.has('legacy')
          )
            throw new Error('Connect a wallet supporting legacy transaction signing');
          const plan = await buildAction(client, deployment, request, connected.signer);
          if (JSON.stringify(plan.review) !== JSON.stringify(reviewed))
            throw new Error(
              'The reviewed conditions changed. Review the action again before signing.',
            );
          const prepared = await prepareTransaction(
            client.rpc,
            connected.signer,
            plan.instructions,
            async () => {
              if ((await client.rpc.getGenesisHash().send()) !== deployment.genesisHash)
                throw new Error('Network changed before signing');
              if (client.wallet.getState().connected?.account.address !== owner)
                throw new Error('Wallet changed before signing');
              updateActivity(key, owner, attempt, { status: 'awaiting-signature' });
              update({ ...empty, key, phase: 'awaiting-signature' });
            },
          );
          if ((await client.rpc.getGenesisHash().send()) !== deployment.genesisHash)
            throw new Error('Network changed before submission');
          if (client.wallet.getState().connected?.account.address !== owner)
            throw new Error('Wallet changed before submission');
          const record: Pending = {
            signature: prepared.signature,
            lastValidBlockHeight: prepared.lastValidBlockHeight,
            owner,
            agreement: plan.review.agreement,
            operation: request.operation,
            ...(request.operation === 'create' ? { createdTerms: request.terms } : {}),
          };
          saveJournal(key, record);
          signed = true;
          updateActivity(key, owner, attempt, { ...record, status: 'pending' });
          update({ ...empty, key, pending: record, phase: 'pending' });
          try {
            await submitTransaction(client.rpc, prepared);
            activity.refresh();
          } catch {
            updateActivity(key, owner, attempt, { status: 'unresolved' });
            update({
              ...empty,
              key,
              pending: record,
              phase: 'unresolved',
              error:
                'Submission feedback was lost or rejected. Checking the signature before any retry.',
            });
          }
          return plan.review.agreement;
        });
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : 'Unable to prepare the transaction';
        // Once the signed identifier is journaled it must remain recoverable, even if storage or HTTP fails.
        if (signed) {
          const record = readJournal(key, owner);
          update({ ...empty, key, pending: record, phase: 'unresolved', error });
          return reviewed.agreement;
        }
        try {
          await withJournalLock(key, async () =>
            updateActivity(key, owner, attempt, { status: 'not-submitted', error }),
          );
        } catch {
          /* The pending journal, rather than optional history, gates retries. */
        }
        update({
          ...empty,
          key,
          phase: 'not-submitted',
          error,
        });
      } finally {
        lock.current = false;
      }
    },
    [
      client,
      deployment,
      key,
      owner,
      current.pending,
      current.unavailable,
      tracking.key,
      activity,
      recoverableSignature,
    ],
  );
  return {
    execute,
    preview: async (request: ActionRequest) => {
      const connected = client.wallet.getState().connected;
      if (!connected?.signer || connected.account.address !== owner)
        throw new Error('Connect the wallet that will sign this action');
      const result = await buildAction(client, deployment, request, connected.signer);
      if (client.wallet.getState().connected?.account.address !== owner)
        throw new Error('Wallet changed while preparing the review');
      return result.review;
    },
    phase: current.phase,
    error: current.error,
    pending,
    activity,
    busy:
      !owner ||
      tracking.key !== key ||
      current.unavailable ||
      !activity.ready ||
      activity.status === 'error' ||
      !!recoverableSignature ||
      !!pending ||
      current.phase === 'preparing' ||
      current.phase === 'awaiting-signature',
  };
}
