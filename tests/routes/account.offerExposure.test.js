/**
 * tests/routes/account.offerExposure.test.js
 *
 * Tests for GET /account/:id/offer-exposure
 *
 * Covers:
 *   1. An account with 3 open sell offers for the same asset returns one
 *      sellingExposure entry with offerCount: 3.
 *   2. liquidityRisk is "high" when more than 80% of a balance is locked
 *      in open offers.
 *   3. An account with no open offers returns empty sellingExposure and
 *      overallLiquidityRisk: "low".
 *   4. A non-existent account returns 404 with AccountNotFound error.
 *
 * All Stellar SDK calls are mocked; no real network requests are made.
 */

"use strict";

const request = require("supertest");
const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

// A syntactically valid Stellar public key used across all test cases.
const ACCOUNT_ID = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

// ── Mock helpers ────────────────────────────────────────────────────────────

/**
 * Builds a minimal mock Horizon account object with the given balances.
 */
function buildAccount(balances) {
  return { id: ACCOUNT_ID, balances };
}

/**
 * Builds a single sell-offer record for a non-native asset.
 */
function buildNonNativeOffer(id, assetCode, assetIssuer, amount) {
  return {
    id: String(id),
    paging_token: String(id),
    seller: ACCOUNT_ID,
    selling_asset_type: "credit_alphanum4",
    selling_asset_code: assetCode,
    selling_asset_issuer: assetIssuer,
    buying_asset_type: "native",
    amount,
    price: "1.0000000",
    last_modified_time: "2026-01-01T00:00:00Z",
  };
}

/**
 * Builds a sell-offer record for native XLM.
 */
function buildNativeOffer(id, amount) {
  return {
    id: String(id),
    paging_token: String(id),
    seller: ACCOUNT_ID,
    selling_asset_type: "native",
    selling_asset_code: undefined,
    selling_asset_issuer: undefined,
    buying_asset_type: "credit_alphanum4",
    buying_asset_code: "USDC",
    buying_asset_issuer: USDC_ISSUER,
    amount,
    price: "0.1000000",
    last_modified_time: "2026-01-01T00:00:00Z",
  };
}

/**
 * Mocks server.offers() to resolve with the given records for forAccount().
 */
function mockOffers(records) {
  jest.spyOn(server, "offers").mockReturnValue({
    forAccount: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records }),
    }),
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GET /account/:id/offer-exposure", () => {
  describe("1. Three sell offers for the same asset → one exposure entry with offerCount: 3", () => {
    it("returns a single sellingExposure entry with offerCount: 3 when the account has 3 open USDC sell offers", async () => {
      jest.spyOn(server, "loadAccount").mockResolvedValue(
        buildAccount([
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: USDC_ISSUER,
            balance: "1000.0000000",
          },
        ]),
      );

      mockOffers([
        buildNonNativeOffer(1, "USDC", USDC_ISSUER, "100.0000000"),
        buildNonNativeOffer(2, "USDC", USDC_ISSUER, "150.0000000"),
        buildNonNativeOffer(3, "USDC", USDC_ISSUER, "200.0000000"),
      ]);

      const res = await request(app).get(`/account/${ACCOUNT_ID}/offer-exposure`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accountId).toBe(ACCOUNT_ID);
      expect(res.body.data.sellingExposure).toHaveLength(1);

      const entry = res.body.data.sellingExposure[0];
      expect(entry.asset.code).toBe("USDC");
      expect(entry.offerCount).toBe(3);
      // 100 + 150 + 200 = 450
      expect(entry.totalSelling).toBe("450.0000000");
    });
  });

  describe("2. liquidityRisk is 'high' when > 80% of the balance is locked", () => {
    it("reports liquidityRisk: 'high' when 90% of the XLM balance is in open sell offers", async () => {
      jest.spyOn(server, "loadAccount").mockResolvedValue(
        buildAccount([
          {
            asset_type: "native",
            balance: "1000.0000000",
          },
        ]),
      );

      // 900 / 1000 = 90% → "high"
      mockOffers([buildNativeOffer(1, "900.0000000")]);

      const res = await request(app).get(`/account/${ACCOUNT_ID}/offer-exposure`);

      expect(res.statusCode).toBe(200);
      const entry = res.body.data.sellingExposure[0];
      expect(entry.asset.code).toBe("XLM");
      expect(entry.liquidityRisk).toBe("high");
      expect(res.body.data.overallLiquidityRisk).toBe("high");
    });

    it("reports liquidityRisk: 'high' and percentageLocked > 80 for a non-native asset", async () => {
      jest.spyOn(server, "loadAccount").mockResolvedValue(
        buildAccount([
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: USDC_ISSUER,
            balance: "500.0000000",
          },
        ]),
      );

      // 450 / 500 = 90% → "high"
      mockOffers([buildNonNativeOffer(1, "USDC", USDC_ISSUER, "450.0000000")]);

      const res = await request(app).get(`/account/${ACCOUNT_ID}/offer-exposure`);

      expect(res.statusCode).toBe(200);
      const entry = res.body.data.sellingExposure[0];
      expect(entry.liquidityRisk).toBe("high");
      expect(parseFloat(entry.percentageLocked)).toBeGreaterThan(80);
    });
  });

  describe("3. No open offers → empty sellingExposure and overallLiquidityRisk: 'low'", () => {
    it("returns empty sellingExposure array and 'low' risk when there are no open offers", async () => {
      jest.spyOn(server, "loadAccount").mockResolvedValue(
        buildAccount([
          { asset_type: "native", balance: "500.0000000" },
        ]),
      );

      mockOffers([]);

      const res = await request(app).get(`/account/${ACCOUNT_ID}/offer-exposure`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.sellingExposure).toEqual([]);
      expect(res.body.data.overallLiquidityRisk).toBe("low");
    });
  });

  describe("4. Non-existent account → 404", () => {
    it("returns 404 with AccountNotFound error type when the account does not exist", async () => {
      const notFoundError = new Error("Not Found");
      notFoundError.response = { status: 404 };
      jest.spyOn(server, "loadAccount").mockRejectedValue(notFoundError);

      const res = await request(app).get(`/account/${ACCOUNT_ID}/offer-exposure`);

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("AccountNotFound");
    });
  });
});
