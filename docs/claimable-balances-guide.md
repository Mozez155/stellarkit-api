# Claimable Balances Guide

Claimable balances let you park funds on the Stellar ledger for a future recipient without requiring that recipient to be online or to have a trustline at the time of creation. This guide covers every claimable balance endpoint in StellarKit API, explains the difference between eligible and pending balances, and walks through a complete check-and-claim workflow.

---

## Table of Contents

1. [What Are Claimable Balances?](#what-are-claimable-balances)
2. [Endpoints Overview](#endpoints-overview)
3. [GET /account/:id/claimable-balances](#get-accountidclaimable-balances)
4. [GET /account/:id/claimable-balances/eligible](#get-accountidclaimable-balanceseligible)
5. [GET /account/:id/claimable-balance-summary](#get-accountidclaimable-balance-summary)
6. [GET /claimable-balances/by-sponsor/:address](#get-claimable-balancesby-sponsoraddress)
7. [GET /claimable-balances/:id/evaluate/:accountId](#get-claimable-balancesidevaluateaccountid)
8. [Eligible vs Pending Balances](#eligible-vs-pending-balances)
9. [Worked Example: Checking and Claiming a Balance](#worked-example-checking-and-claiming-a-balance)
10. [Error Reference](#error-reference)

---

## What Are Claimable Balances?

A **claimable balance** is a Stellar ledger entry that holds an amount of any asset on behalf of one or more future recipients (claimants). Each claimant is paired with a **predicate** — a rule that controls when the claim is allowed.

Key properties:

- The recipient's account does not need to exist when the balance is created.
- No trustline is required in advance; Stellar adds one automatically on claim.
- Funds are not delivered until a claimant actively submits a `claimClaimableBalance` operation.
- The creator (sponsor) pays the base reserve until the balance is claimed or reclaimed.

Predicates can be simple (`unconditional`) or time-bounded (`abs_before`, `abs_after`) and can be nested with `and`, `or`, and `not`.

---

## Endpoints Overview

| Endpoint | Description |
| -------- | ----------- |
| `GET /account/:id/claimable-balances` | All claimable balances where the account is a claimant (raw Horizon data) |
| `GET /account/:id/claimable-balances/eligible` | Evaluated and categorised: eligible, not-yet-claimable, or expired |
| `GET /account/:id/claimable-balance-summary` | Aggregate counts and total amounts per category |
| `GET /claimable-balances/by-sponsor/:address` | All balances sponsored by a given address |
| `GET /claimable-balances/:id/evaluate/:accountId` | Evaluate claimability for one specific balance and account |

---

## GET /account/:id/claimable-balances

Returns a paginated list of all claimable balances on the network where `account` is listed as a claimant. This endpoint returns raw, unevaluated data — predicates are included but not checked against the current ledger time.

### Query Parameters

| Parameter | Type | Default | Description |
| --------- | ---- | ------- | ----------- |
| `limit` | integer | `20` | Maximum records per page (max: 200) |
| `cursor` | string | — | Horizon pagination cursor from a previous response |
| `order` | string | `desc` | Sort order: `asc` or `desc` |
| `fresh` | boolean | `false` | Set to `true` to bypass the server-side cache |

### curl Example

```bash
curl "http://localhost:3000/account/GABC.../claimable-balances?limit=10"
```

### Sample Response

```json
{
  "success": true,
  "data": {
    "balances": [
      {
        "balanceId": "00000000929b20b72e5890ab51c24f1cc46fa01c4f318d8d33367d24dd614cfdf5491072",
        "asset": { "code": "USDC", "issuer": "GBBD47IF...", "type": "credit_alphanum4" },
        "amount": "100.0000000",
        "claimants": [
          {
            "destination": "GABC...",
            "predicate": { "abs_before": "2026-12-31T23:59:59Z" }
          }
        ],
        "createdAt": "2026-06-01T12:00:00Z"
      }
    ]
  },
  "meta": {
    "count": 1,
    "limit": 10,
    "order": "desc",
    "nextCursor": null,
    "hasMore": false
  }
}
```

---

## GET /account/:id/claimable-balances/eligible

Returns every claimable balance where the account is a claimant and evaluates each one against the **current ledger time**. Each balance is categorised as:

- **`eligible`** — the predicate is satisfied right now and the account can claim immediately.
- **`pending`** — a future `abs_after` predicate has not been met yet.
- **`expired`** — an `abs_before` deadline has already passed and the account can no longer claim.

This is the recommended endpoint for building dashboards and claiming UIs because predicate evaluation is done server-side.

### Query Parameters

Same as `/claimable-balances` above (`limit`, `cursor`, `order`, `fresh`).

### curl Example

```bash
curl "http://localhost:3000/account/GABC.../claimable-balances/eligible"
```

### Sample Response

```json
{
  "success": true,
  "data": {
    "eligible": [
      {
        "balanceId": "00000000929b20b72e5890...",
        "asset": { "code": "USDC", "issuer": "GBBD47IF...", "type": "credit_alphanum4" },
        "amount": "50.0000000",
        "claimableFrom": null,
        "claimableUntil": null,
        "predicate": { "unconditional": true }
      }
    ],
    "pending": [
      {
        "balanceId": "000000008f3c1a...",
        "asset": { "code": "XLM", "issuer": null, "type": "native" },
        "amount": "200.0000000",
        "claimableFrom": "2027-01-01T00:00:00Z",
        "claimableUntil": null,
        "predicate": { "abs_after": "2027-01-01T00:00:00Z" }
      }
    ],
    "expired": []
  },
  "meta": {
    "count": 2,
    "limit": 20,
    "order": "desc",
    "nextCursor": null,
    "hasMore": false
  }
}
```

### Reading the Response

- Iterate `eligible` to find balances the user can claim right now.
- Display `pending` balances with `claimableFrom` so the user knows when to return.
- Optionally display `expired` balances as history, but do not prompt the user to claim them.

---

## GET /account/:id/claimable-balance-summary

Returns aggregate counts and total amounts per category (`eligible`, `pending`, `expired`) without listing every individual balance. Useful for dashboard counters and notification badges.

### curl Example

```bash
curl "http://localhost:3000/account/GABC.../claimable-balance-summary"
```

### Sample Response

```json
{
  "success": true,
  "data": {
    "accountId": "GABC...",
    "eligible": {
      "count": 2,
      "totalByAsset": [
        { "asset": { "code": "USDC", "issuer": "GBBD47IF...", "type": "credit_alphanum4" }, "total": "150.0000000" }
      ]
    },
    "pending": {
      "count": 1,
      "totalByAsset": [
        { "asset": { "code": "XLM", "issuer": null, "type": "native" }, "total": "200.0000000" }
      ]
    },
    "expired": {
      "count": 0,
      "totalByAsset": []
    }
  }
}
```

---

## GET /claimable-balances/by-sponsor/:address

Returns a paginated list of claimable balances whose on-ledger reserve is paid by the specified sponsor address. Useful for custodial services and issuers that manage claimable balances on behalf of users.

Responses are cached per sponsor address and pagination parameters. Pass `?fresh=true` to bypass the cache.

### Query Parameters

| Parameter | Type | Default | Description |
| --------- | ---- | ------- | ----------- |
| `limit` | integer | `20` | Page size (max: 200) |
| `cursor` | string | — | Horizon pagination cursor |
| `fresh` | boolean | `false` | Bypass cache |

### curl Example

```bash
curl "http://localhost:3000/claimable-balances/by-sponsor/GSPONSOR...?limit=5"
```

### Sample Response

```json
{
  "success": true,
  "data": {
    "balances": [
      {
        "balanceId": "00000000929b20b72e5890ab51c24f1cc46fa01c4f318d8d33367d24dd614cfdf5491072",
        "asset": { "code": "USDC", "issuer": "GBBD47IF...", "type": "credit_alphanum4" },
        "amount": "100.0000000",
        "claimants": [
          {
            "destination": "GABC...",
            "predicate": { "unconditional": true }
          }
        ],
        "createdAt": "2026-06-01T12:00:00Z"
      }
    ]
  },
  "meta": {
    "count": 1,
    "limit": 5,
    "order": "desc",
    "nextCursor": null,
    "hasMore": false
  }
}
```

---

## GET /claimable-balances/:id/evaluate/:accountId

Evaluates whether a **specific account** can claim a **specific claimable balance** right now. Unlike the eligible endpoint (which scans all balances for an account), this endpoint accepts the exact balance ID and returns a single evaluation result.

### Path Parameters

| Parameter | Description |
| --------- | ----------- |
| `id` | Claimable balance ID (56-character hex, e.g. `00000000929b20b72e5890...`) |
| `accountId` | Stellar public key of the potential claimant |

### curl Example

```bash
curl "http://localhost:3000/claimable-balances/00000000929b20b72e5890ab51c24f1cc46fa01c4f318d8d33367d24dd614cfdf5491072/evaluate/GABC..."
```

### Sample Response — Claimable Now

```json
{
  "success": true,
  "data": {
    "canClaimNow": true,
    "reason": "The balance is claimable unconditionally.",
    "claimableFrom": null,
    "claimableUntil": null,
    "predicate": { "unconditional": true }
  }
}
```

### Sample Response — Not Yet Claimable

```json
{
  "success": true,
  "data": {
    "canClaimNow": false,
    "reason": "The claimable window has not started yet (starts at 2027-01-01T00:00:00Z).",
    "claimableFrom": "2027-01-01T00:00:00Z",
    "claimableUntil": null,
    "predicate": { "abs_after": "2027-01-01T00:00:00Z" }
  }
}
```

### Error Responses

| Status | Reason |
| ------ | ------ |
| `400` | Account is not a listed claimant for this balance |
| `404` | Claimable balance ID not found on the network |

---

## Eligible vs Pending Balances

The distinction between **eligible** and **pending** is critical when building claiming UIs.

| Status | Meaning | Action for user |
| ------ | ------- | --------------- |
| `eligible` | Predicate is currently satisfied — the account can submit `claimClaimableBalance` right now | Show a "Claim" button |
| `pending` | A future `abs_after` gate has not opened yet | Show the `claimableFrom` date |
| `expired` | An `abs_before` deadline has passed — the creator can reclaim these funds | Inform the user the window has closed |

### When to Use Each Endpoint

| Goal | Recommended endpoint |
| ---- | -------------------- |
| Show how many unclaimed balances a user has | `/account/:id/claimable-balance-summary` |
| Build a claiming UI that shows what can be claimed now | `/account/:id/claimable-balances/eligible` |
| Get the raw list with predicates (for custom logic) | `/account/:id/claimable-balances` |
| Check one specific balance before prompting a user | `/claimable-balances/:id/evaluate/:accountId` |
| List all balances funded by a sponsor | `/claimable-balances/by-sponsor/:address` |

---

## Worked Example: Checking and Claiming a Balance

This example shows a complete Node.js workflow using the StellarKit API and the Stellar SDK:

1. Call the eligible endpoint to find claimable balances.
2. Use the evaluate endpoint to double-check before submitting.
3. Build and submit the claim transaction.

```js
const fetch = require("node-fetch");
const {
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  Server,
  Account,
} = require("@stellar/stellar-sdk");

const API_BASE = "http://localhost:3000";
const HORIZON_URL = "https://horizon-testnet.stellar.org";

async function claimAll(claimantSecret) {
  const claimant = Keypair.fromSecret(claimantSecret);
  const accountId = claimant.publicKey();

  // Step 1 — fetch all eligible balances
  const eligRes = await fetch(
    `${API_BASE}/account/${accountId}/claimable-balances/eligible`,
  );
  const eligBody = await eligRes.json();

  if (!eligBody.success) {
    throw new Error(`Failed to fetch eligible balances: ${eligBody.error.message}`);
  }

  const eligible = eligBody.data.eligible;
  console.log(`Found ${eligible.length} eligible balance(s).`);

  for (const balance of eligible) {
    const balanceId = balance.balanceId;

    // Step 2 — double-check claimability
    const evalRes = await fetch(
      `${API_BASE}/claimable-balances/${balanceId}/evaluate/${accountId}`,
    );
    const evalBody = await evalRes.json();

    if (!evalBody.success || !evalBody.data.canClaimNow) {
      console.log(`Skipping ${balanceId}: ${evalBody.data?.reason}`);
      continue;
    }

    // Step 3 — build and submit the claim transaction
    const horizon = new Server(HORIZON_URL);
    const accountData = await horizon.loadAccount(accountId);

    const tx = new TransactionBuilder(
      new Account(accountData.id, accountData.sequence),
      { fee: "100", networkPassphrase: Networks.TESTNET },
    )
      .addOperation(Operation.claimClaimableBalance({ balanceId }))
      .setTimeout(30)
      .build();

    tx.sign(claimant);

    const result = await horizon.submitTransaction(tx);
    console.log(`Claimed ${balanceId} — tx hash: ${result.hash}`);
  }
}
```

### Key Points

- Always call `evaluate` before submitting a claim transaction if your UI has been open for more than a few seconds — time predicates can expire between page load and submission.
- The Stellar SDK's `claimClaimableBalance` operation requires the full 56-character hex balance ID (the `balanceId` field in all StellarKit responses).
- If `canClaimNow` is `false` with a reason containing "started" or "opened", the `claimableFrom` field tells you when to retry.
- A claim adds a trustline for the asset automatically if the claimant does not already hold one. Ensure the account has enough XLM reserve before claiming.

---

## Error Reference

| Status | Error Type | Description |
| ------ | ---------- | ----------- |
| `400` | `ValidationError` | Invalid account ID or balance ID format |
| `400` | `NotAClaimant` | The specified account is not a claimant on that balance |
| `404` | `AccountNotFound` | The account does not exist on the network |
| `404` | `BalanceNotFound` | The claimable balance ID was not found |
| `429` | `RateLimitExceeded` | Too many requests; back off and retry |

---

## See Also

- [Account Endpoints Guide](account-endpoints.md) — all account endpoints grouped by use case
- [Error Reference](error-reference.md) — full error type catalogue
- [Getting Started Guide](getting-started.md) — initial project setup
