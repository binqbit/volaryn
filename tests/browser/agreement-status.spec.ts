import { expect, test } from '@playwright/test';
import { balanceFixture } from './support/balanceFixture';
import { switchWallet } from './support/actions';

test('activation distinguishes pending, finality and the holder’s next action', async ({
  page,
}, info) => {
  const { state, account } = await balanceFixture(page);
  const d = state.deployment;
  state.wallets[d.localnet!.holder]!.accounts = [
    account(d.usdcMint, d.localnet!.holderUsdc, '100000000'),
    account(state.agreement.underlyingMint, d.localnet!.holder, '2000000000'),
  ];
  let phase: 'pending' | 'provisional' | 'finalized' = 'pending';
  const receipt = {
    id: '1',
    signature: '1'.repeat(64),
    owner: d.localnet!.holder,
    agreement: state.agreement.address,
    side: 'writer',
    actorRole: 'holder',
    operation: 'activate',
    createdTerms: null,
    lastValidBlockHeight: '1000',
    createdAt: 1700000000,
    updatedAt: 1700000000,
  };
  await page.route('**/api/activity?*', (route) =>
    route.fulfill({
      json: {
        items: [{ ...receipt, status: phase }],
        pending: phase === 'finalized' ? [] : [{ ...receipt, status: phase }],
        next: null,
      },
    }),
  );
  await page.route('**/rpc', async (route) => {
    const { id, method } = route.request().postDataJSON();
    if (method === 'getSignatureStatuses')
      return route.fulfill({
        json: {
          jsonrpc: '2.0',
          id,
          result: {
            context: { slot: 42 },
            value: [
              phase === 'pending'
                ? null
                : {
                    slot: 42,
                    err: null,
                    confirmationStatus: phase === 'provisional' ? 'confirmed' : 'finalized',
                    confirmations: phase === 'provisional' ? 1 : null,
                  },
            ],
          },
        },
      });
    if (method === 'getBlockHeight')
      return route.fulfill({ json: { jsonrpc: '2.0', id, result: 42 } });
    await route.fallback();
  });
  await page.goto(`/agreements/${state.agreement.address}`);
  await switchWallet(page, 'holder');
  await expect(
    page.getByRole('button', { name: 'Activating protection…', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Protection activated', exact: true })).toHaveCount(
    0,
  );
  phase = 'provisional';
  await expect(
    page.getByRole('button', { name: 'Activating protection… Awaiting finality' }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Protection activated', exact: true })).toHaveCount(
    0,
  );
  phase = 'finalized';
  await expect(
    page.getByRole('button', { name: 'Protection activated', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Activate protection', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Exercise protection', exact: true })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Protection activated', exact: true }),
  ).toBeDisabled();
  state.agreement = { ...state.agreement, status: 'active', holder: d.localnet!.holder };
  await expect(page.getByRole('status', { name: 'Agreement outcome' })).toHaveText(
    'Your protection is active',
  );
  await expect(page.getByLabel('Your agreement role')).toContainText(
    'protection holder · payout recipient',
  );
  await expect(
    page.getByRole('button', { name: 'Exercise protection', exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Reclaim expired reserve' })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('holder-active.png'), fullPage: true });
  expect(state.unexpected).toEqual([]);
});

for (const scenario of [
  {
    status: 'active',
    writer: 'Your offer has been activated',
    holder: 'Your protection is active',
  },
  {
    status: 'exercised',
    writer: 'PreStocks delivered to your settlement account',
    holder: 'Your USDC payout was settled',
  },
  {
    status: 'expired',
    writer: 'Your reserve was reclaimed',
    holder: 'Your protection expired without payout',
  },
  { status: 'cancelled', writer: 'Your offer was cancelled', holder: 'Offer cancelled' },
] as const) {
  test(`${scenario.status} distinguishes the capital provider from the payout recipient`, async ({
    page,
  }, info) => {
    const { state, account } = await balanceFixture(page);
    const d = state.deployment;
    state.agreement = {
      ...state.agreement,
      status: scenario.status,
      holder: scenario.status === 'cancelled' ? null : d.localnet!.holder,
      designatedCounterparty: d.localnet!.holder,
    };
    for (const role of ['writer', 'holder'] as const) {
      state.wallets[d.localnet![role]]!.accounts = [
        account(d.usdcMint, d.localnet![`${role}Usdc`], '100000000'),
        account(state.agreement.underlyingMint, d.localnet![role], '2000000000'),
      ];
    }
    await page.goto(`/agreements/${state.agreement.address}`);
    await switchWallet(page, 'writer');
    const outcome = page.getByRole('status', { name: 'Agreement outcome' });
    await expect(outcome).toHaveText(scenario.writer);
    await expect(page.getByLabel('Your agreement role')).toHaveText(
      'Your role: writer · capital provider',
    );
    await expect(page.getByRole('button', { name: 'Exercise protection' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Activate/ })).toHaveCount(0);
    if (scenario.status === 'active') {
      await expect(
        page.getByRole('button', { name: 'Reserve locked until expiry' }),
      ).toBeDisabled();
      await expect(
        page.getByText('Your reserved USDC stays locked', { exact: false }),
      ).toBeVisible();
    } else {
      await expect(page.getByRole('button', { name: 'Recover residual funds' })).toBeEnabled();
    }
    await page.screenshot({ path: info.outputPath('writer.png'), fullPage: true });
    await switchWallet(page, 'holder');
    await expect(outcome).toHaveText(scenario.holder);
    if (scenario.status === 'active')
      await expect(page.getByRole('button', { name: 'Exercise protection' })).toBeEnabled();
    else await expect(page.getByRole('button', { name: 'Exercise protection' })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /Reclaim|Recover|Cancel offer|Activate/ }),
    ).toHaveCount(0);
    if (scenario.status === 'cancelled')
      await expect(page.getByLabel('Your agreement role')).toHaveText('Your role: viewer');
    else
      await expect(page.getByLabel('Your agreement role')).toHaveText(
        'Your role: protection holder · payout recipient',
      );
    expect(state.unexpected).toEqual([]);
  });
}

test('expiry, reserved offers and public viewing never imply ownership of someone else’s payout', async ({
  page,
}) => {
  const { state, account } = await balanceFixture(page);
  const d = state.deployment;
  state.wallets[d.localnet!.writer]!.accounts = [
    account(d.usdcMint, d.localnet!.writerUsdc, '100000000'),
  ];
  state.agreement = { ...state.agreement, designatedCounterparty: d.authority };
  await page.goto(`/agreements/${state.agreement.address}`);
  await expect(page.getByLabel('Your agreement role')).toHaveText('Public agreement');
  await switchWallet(page, 'holder');
  await expect(page.getByLabel('Your agreement role')).toHaveText('Your role: viewer');
  await expect(page.getByRole('button', { name: 'Activate protection' })).toHaveCount(0);
  state.agreement = { ...state.agreement, designatedCounterparty: d.localnet!.holder };
  await page.reload();
  await expect(page.getByLabel('Your agreement role')).toHaveText(
    'Reserved for you · not activated',
  );
  await expect(page.getByRole('status', { name: 'Agreement outcome' })).toHaveText(
    'Protection not activated',
  );
  state.agreement = { ...state.agreement, status: 'active', holder: d.authority };
  await page.reload();
  await expect(page.getByLabel('Your agreement role')).toHaveText('Your role: viewer');
  await expect(page.getByRole('status', { name: 'Agreement outcome' })).toHaveText(
    'Protection activated',
  );
  await expect(page.getByRole('button', { name: /Exercise|Reclaim|Recover|Activate/ })).toHaveCount(
    0,
  );
  state.agreement = { ...state.agreement, holder: d.localnet!.holder, expiresAt: '1' };
  await page.reload();
  await expect(page.getByRole('status', { name: 'Agreement outcome' })).toHaveText(
    'Your protection has expired',
  );
  await expect(page.getByRole('button', { name: 'Protection expired' })).toBeDisabled();
  await expect(page.getByLabel('Delivery token account', { exact: true })).toHaveCount(0);
  await switchWallet(page, 'writer');
  await expect(page.getByRole('status', { name: 'Agreement outcome' })).toHaveText(
    'Your reserve is available to reclaim',
  );
  await expect(page.getByRole('button', { name: 'Reclaim expired reserve' })).toBeEnabled();
  expect(state.unexpected).toEqual([]);
});

test('an unavailable chain clock does not claim protection is still exercisable', async ({
  page,
}) => {
  const { state, account } = await balanceFixture(page);
  const d = state.deployment;
  state.agreement = { ...state.agreement, status: 'active', holder: d.localnet!.holder };
  state.wallets[d.localnet!.holder]!.accounts = [
    account(d.usdcMint, d.localnet!.holderUsdc, '100000000'),
    account(state.agreement.underlyingMint, d.localnet!.holder, '2000000000'),
  ];
  await page.route('**/rpc', async (route) => {
    const { method, id } = route.request().postDataJSON();
    if (method === 'getBlockTime')
      return route.fulfill({ json: { jsonrpc: '2.0', id, result: null } });
    await route.fallback();
  });
  await page.goto(`/agreements/${state.agreement.address}`);
  await switchWallet(page, 'holder');
  await expect(page.getByRole('status', { name: 'Agreement outcome' })).toHaveText(
    'Protection activated · checking expiry',
  );
  await expect(page.getByRole('button', { name: 'Exercise protection' })).toBeDisabled();
  state.wallets[d.localnet!.writer]!.accounts = [
    account(d.usdcMint, d.localnet!.writerUsdc, '100000000'),
  ];
  // Even a deadline far in the browser's past must not enable reclaim without chain time.
  state.agreement = { ...state.agreement, expiresAt: '1' };
  await page.reload();
  await switchWallet(page, 'writer');
  await expect(page.getByRole('button', { name: 'Reserve locked until expiry' })).toBeDisabled();
  expect(state.unexpected).toEqual([]);
});

for (const side of ['holder', 'writer'] as const) {
  test(`${side} origin cancellation and terminal cleanup remain available without chain time`, async ({
    page,
  }) => {
    const { state, account } = await balanceFixture(page);
    const d = state.deployment;
    const creator = d.localnet![side];
    state.agreement = {
      ...state.agreement,
      side,
      creator,
      holder: side === 'holder' ? creator : null,
      writer: side === 'writer' ? creator : null,
    };
    for (const role of ['holder', 'writer'] as const) {
      state.wallets[d.localnet![role]]!.accounts = [
        account(d.usdcMint, d.localnet![`${role}Usdc`], '100000000'),
      ];
    }
    await page.route('**/rpc', async (route) => {
      const { method, id } = route.request().postDataJSON();
      if (method === 'getBlockTime')
        return route.fulfill({ json: { jsonrpc: '2.0', id, result: null } });
      await route.fallback();
    });
    await page.goto(`/agreements/${state.agreement.address}`);
    await switchWallet(page, side);
    await expect(
      page.getByRole('button', {
        name: side === 'holder' ? 'Cancel request' : 'Cancel offer',
        exact: true,
      }),
    ).toBeEnabled();
    await expect(
      page.getByText('Deadline-dependent actions are paused', { exact: false }),
    ).toHaveCount(0);

    await switchWallet(page, side === 'holder' ? 'writer' : 'holder');
    await expect(
      page.getByRole('button', {
        name: side === 'holder' ? 'Fund protection' : 'Activate protection',
        exact: true,
      }),
    ).toBeDisabled();
    await expect(page.getByRole('button', { name: /Cancel request|Cancel offer/ })).toHaveCount(0);

    state.agreement = { ...state.agreement, status: 'cancelled' };
    await page.reload();
    await expect(page.getByRole('button', { name: 'Recover residual funds' })).toHaveCount(0);
    await switchWallet(page, side);
    await expect(page.getByRole('button', { name: 'Recover residual funds' })).toBeEnabled();
    expect(state.unexpected).toEqual([]);
  });
}
