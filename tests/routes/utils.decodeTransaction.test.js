/**
 * tests/routes/utils.decodeTransaction.test.js
 *
 * Tests for POST /utils/decode-transaction
 *
 * Covers:
 *   1. A changeTrust operation decodes with type: "change_trust", asset, and
 *      limit fields.
 *   2. A manageOffer (manage_sell_offer) operation decodes with
 *      type: "manage_sell_offer", selling, buying, amount, and price fields.
 *   3. A setOptions operation decodes with type: "set_options" and the
 *      relevant options fields.
 *   4. A transaction with multiple operations decodes all of them in order.
 *
 * All tests build real XDR using the Stellar SDK so fixtures stay accurate
 * across SDK version bumps; no hard-coded base64 strings are used.
 */

"use strict";

const request = require("supertest");
const app = require("../../src/index");
const {
  Asset,
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  Account,
} = require("@stellar/stellar-sdk");

// ── Shared test fixture values ───────────────────────────────────────────────

const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC = new Asset("USDC", USDC_ISSUER);

// ── Helper: build and encode a transaction with specific operations ───────────

/**
 * Builds a Stellar transaction containing the given operations and returns its
 * base64 XDR envelope string.
 *
 * @param {import("@stellar/stellar-sdk").xdr.Operation[]} ops - Operations to add
 * @returns {string} base64-encoded TransactionEnvelope XDR
 */
function buildXdr(ops) {
  const source = Keypair.random();
  const account = new Account(source.publicKey(), "100");

  let builder = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  });

  for (const op of ops) {
    builder = builder.addOperation(op);
  }

  return builder.setTimeout(0).build().toEnvelope().toXDR("base64");
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe("POST /utils/decode-transaction", () => {
  // ── 1. changeTrust ──────────────────────────────────────────────────────

  describe("changeTrust operation", () => {
    it("decodes with type: 'change_trust', asset, and limit fields", async () => {
      const xdr = buildXdr([
        Operation.changeTrust({ asset: USDC, limit: "1000" }),
      ]);

      const res = await request(app)
        .post("/utils/decode-transaction")
        .send({ xdr });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const op = res.body.data.operations[0];
      expect(op.type).toBe("change_trust");
      // The SDK returns 'line' for the asset on changeTrust
      expect(op).toHaveProperty("line");
      expect(op.line).toMatchObject({ code: "USDC", issuer: USDC_ISSUER });
      expect(op).toHaveProperty("limit");
      expect(op.limit).toBe("1000.0000000");
    });

    it("decodes a changeTrust that removes a trustline (limit: 0)", async () => {
      const xdr = buildXdr([
        Operation.changeTrust({ asset: USDC, limit: "0" }),
      ]);

      const res = await request(app)
        .post("/utils/decode-transaction")
        .send({ xdr });

      expect(res.statusCode).toBe(200);
      const op = res.body.data.operations[0];
      expect(op.type).toBe("change_trust");
      expect(op.limit).toBe("0.0000000");
    });
  });

  // ── 2. manageOffer (manage_sell_offer) ──────────────────────────────────

  describe("manageSellOffer operation", () => {
    it("decodes with type: 'manage_sell_offer', selling, buying, amount, and price fields", async () => {
      const xdr = buildXdr([
        Operation.manageSellOffer({
          selling: Asset.native(),
          buying: USDC,
          amount: "50",
          price: "2",
        }),
      ]);

      const res = await request(app)
        .post("/utils/decode-transaction")
        .send({ xdr });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const op = res.body.data.operations[0];
      expect(op.type).toBe("manage_sell_offer");
      expect(op).toHaveProperty("selling");
      expect(op).toHaveProperty("buying");
      expect(op).toHaveProperty("amount");
      expect(op).toHaveProperty("price");

      // selling is native XLM
      expect(op.selling).toMatchObject({ code: "XLM" });
      // buying is USDC
      expect(op.buying).toMatchObject({ code: "USDC", issuer: USDC_ISSUER });
      expect(op.amount).toBe("50.0000000");
      // price can be encoded as a string or object; check the numeric value
      const priceNum = typeof op.price === "object"
        ? op.price.n / op.price.d
        : parseFloat(op.price);
      expect(priceNum).toBeCloseTo(2, 4);
    });

    it("decodes a zero-amount offer (cancellation) correctly", async () => {
      const xdr = buildXdr([
        Operation.manageSellOffer({
          selling: Asset.native(),
          buying: USDC,
          amount: "0",
          price: "1",
          offerId: "999",
        }),
      ]);

      const res = await request(app)
        .post("/utils/decode-transaction")
        .send({ xdr });

      expect(res.statusCode).toBe(200);
      const op = res.body.data.operations[0];
      expect(op.type).toBe("manage_sell_offer");
      expect(op.amount).toBe("0.0000000");
    });
  });

  // ── 3. setOptions ───────────────────────────────────────────────────────

  describe("setOptions operation", () => {
    it("decodes with type: 'set_options' and the provided option fields", async () => {
      const xdr = buildXdr([
        Operation.setOptions({
          homeDomain: "example.com",
          lowThreshold: 1,
          medThreshold: 2,
          highThreshold: 3,
        }),
      ]);

      const res = await request(app)
        .post("/utils/decode-transaction")
        .send({ xdr });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const op = res.body.data.operations[0];
      expect(op.type).toBe("set_options");
      expect(op).toHaveProperty("homeDomain", "example.com");
      expect(op).toHaveProperty("lowThreshold", 1);
      expect(op).toHaveProperty("medThreshold", 2);
      expect(op).toHaveProperty("highThreshold", 3);
    });

    it("decodes a setOptions that only sets a new signer", async () => {
      const newSigner = Keypair.random();
      const xdr = buildXdr([
        Operation.setOptions({
          signer: { ed25519PublicKey: newSigner.publicKey(), weight: 1 },
        }),
      ]);

      const res = await request(app)
        .post("/utils/decode-transaction")
        .send({ xdr });

      expect(res.statusCode).toBe(200);
      const op = res.body.data.operations[0];
      expect(op.type).toBe("set_options");
      expect(op).toHaveProperty("signer");
    });
  });

  // ── 4. Multiple operations decoded in order ─────────────────────────────

  describe("transaction with multiple operations", () => {
    it("decodes all operations in the correct order", async () => {
      const dest = Keypair.random();

      const xdr = buildXdr([
        // op 0 – payment
        Operation.payment({
          destination: dest.publicKey(),
          asset: Asset.native(),
          amount: "10",
        }),
        // op 1 – changeTrust
        Operation.changeTrust({ asset: USDC, limit: "500" }),
        // op 2 – manageSellOffer
        Operation.manageSellOffer({
          selling: Asset.native(),
          buying: USDC,
          amount: "25",
          price: "3",
        }),
        // op 3 – setOptions
        Operation.setOptions({ homeDomain: "stellar.org" }),
      ]);

      const res = await request(app)
        .post("/utils/decode-transaction")
        .send({ xdr });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const { operations, operationCount } = res.body.data;

      expect(operationCount).toBe(4);
      expect(operations).toHaveLength(4);

      // Verify types appear in order
      expect(operations[0].type).toBe("payment");
      expect(operations[1].type).toBe("change_trust");
      expect(operations[2].type).toBe("manage_sell_offer");
      expect(operations[3].type).toBe("set_options");

      // Each decoded op must carry an index field matching its position
      operations.forEach((op, i) => {
        expect(op.index).toBe(i);
      });
    });

    it("returns operationCount equal to the length of the operations array", async () => {
      const dest = Keypair.random();
      const xdr = buildXdr([
        Operation.payment({ destination: dest.publicKey(), asset: Asset.native(), amount: "1" }),
        Operation.changeTrust({ asset: USDC, limit: "1000" }),
      ]);

      const res = await request(app)
        .post("/utils/decode-transaction")
        .send({ xdr });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.operationCount).toBe(res.body.data.operations.length);
    });
  });
});
