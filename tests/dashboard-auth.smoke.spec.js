const { test, expect } = require('@playwright/test');

const FORM_ID = '0xfeedface';
const CREATOR = '0x1111111111111111111111111111111111111111111111111111111111111111';
const ADMIN = '0x2222222222222222222222222222222222222222222222222222222222222222';
const USER = '0x3333333333333333333333333333333333333333333333333333333333333333';

function mockDashboardState({ connectedAddress, adminAddresses = [] }) {
  return {
    walletConnected: true,
    connectedAddress,
    adminAddresses,
    walForm: {
      id: FORM_ID,
      title: 'E2E Demo Form',
      creator: CREATOR,
      submissionCount: 2,
      finalManifestRoot: null,
      sealedAtMs: null,
      isSealed: false,
      definitionBlobId: [],
      definitionHash: [],
      createdAtMs: Date.now(),
    },
    submissionEvents: [
      {
        formId: FORM_ID,
        submissionBlobId: 'blob-one',
        submissionHash: [1, 2, 3],
        submitter: USER,
        submittedAtMs: Date.now() - 5_000,
        sequence: 0,
        txDigest: '0xtx1',
      },
      {
        formId: FORM_ID,
        submissionBlobId: 'blob-two',
        submissionHash: [4, 5, 6],
        submitter: CREATOR,
        submittedAtMs: Date.now() - 2_000,
        sequence: 1,
        txDigest: '0xtx2',
      },
    ],
  };
}

async function openDashboard(page, mocks) {
  await page.addInitScript((injected) => {
    window.__WALFORMS_E2E_MOCKS__ = injected;
  }, mocks);
  await page.goto(`/dashboard.html?id=${FORM_ID}`);
}

test.describe('Dashboard auth smoke', () => {
  test('creator can access and sees creator badge', async ({ page }) => {
    await openDashboard(page, mockDashboardState({
      connectedAddress: CREATOR,
      adminAddresses: [ADMIN],
    }));

    await expect(page.locator('#dashboard')).toBeVisible();
    await expect(page.locator('#dash-access-badge')).toHaveText('Access as Creator');
    await expect(page.locator('#dash-form-title')).toHaveText('E2E Demo Form');
  });

  test('admin can access and sees admin badge', async ({ page }) => {
    await openDashboard(page, mockDashboardState({
      connectedAddress: ADMIN,
      adminAddresses: [ADMIN],
    }));

    await expect(page.locator('#dashboard')).toBeVisible();
    await expect(page.locator('#dash-access-badge')).toHaveText('Access as Admin');
    await expect(page.locator('#dash-form-meta')).toContainText('Created by');
  });

  test('non-creator non-admin is blocked', async ({ page }) => {
    await openDashboard(page, mockDashboardState({
      connectedAddress: USER,
      adminAddresses: [ADMIN],
    }));

    await expect(page.locator('#dashboard')).toBeHidden();
    await expect(page.locator('#auth-message')).toContainText('Not authorized');
    await expect(page.locator('#auth-message')).toContainText('Only the form creator');
  });
});
