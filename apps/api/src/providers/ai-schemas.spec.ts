import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  validateIntent,
  validateKnowledge,
  validateColumnMappings,
} from "./ai-schemas";

describe("ai-schemas", () => {
  describe("validateIntent", () => {
    it("should pass valid intent with all fields", () => {
      const raw = {
        language: "ar-EG",
        dialect: "EGYPTIAN_ARABIC",
        turnIntent: "PROPERTY_SEARCH",
        bedrooms: 3,
        budgetMin: 500000,
        budgetMax: 1000000,
        locations: ["New Cairo"],
        propertyTypes: ["apartment"],
        purchaseIntent: 75,
      };

      const result = validateIntent(raw);

      assert.equal(result.language, "ar-EG");
      assert.equal(result.dialect, "EGYPTIAN_ARABIC");
      assert.equal(result.turnIntent, "PROPERTY_SEARCH");
      assert.equal(result.bedrooms, 3);
      assert.equal(result.budgetMin, 500000);
    });

    it("should default language from previous when missing", () => {
      const raw = {
        turnIntent: "SMALL_TALK",
      };

      const previous = {
        language: "en-US",
      };

      const result = validateIntent(raw, undefined, previous);

      assert.equal(result.language, "en-US");
    });

    it("should default to ar-EG when language and previous both missing", () => {
      const raw = {
        turnIntent: "PROPERTY_SEARCH",
      };

      const result = validateIntent(raw);

      assert.equal(result.language, "ar-EG");
    });

    it("should reject invalid enum and return degraded intent", () => {
      const raw = {
        language: "ar-EG",
        turnIntent: "INVALID_INTENT_VALUE",
      };

      const logger = {
        warn: (msg: string) => {
          assert.match(msg, /Intent validation failed/);
        },
      };

      const result = validateIntent(raw, logger);

      assert.equal(result.language, "ar-EG");
      assert.equal(result.extractionDegraded, true);
      assert.equal(result.turnIntent, undefined);
    });

    it("should reject bedrooms out of range", () => {
      const raw = {
        language: "ar-EG",
        bedrooms: 25, // max is 20
      };

      const logger = {
        warn: (msg: string) => {
          assert.match(msg, /Intent validation failed/);
        },
      };

      const result = validateIntent(raw, logger);

      assert.equal(result.extractionDegraded, true);
      assert.equal(result.bedrooms, undefined);
    });

    it("should accept confidence 0-1 range for proximity preferences", () => {
      const raw = {
        language: "ar-EG",
        proximityPreferences: [
          {
            targetType: "LANDMARK",
            targetName: "Cairo Airport",
            preference: "NEAR",
            maxDistanceMeters: 5000,
          },
        ],
      };

      const result = validateIntent(raw);

      assert.equal(result.language, "ar-EG");
      assert.equal(result.proximityPreferences?.length, 1);
      assert.equal(result.proximityPreferences?.[0]?.targetName, "Cairo Airport");
    });

    it("should preserve presentation state", () => {
      const raw = {
        language: "ar-EG",
        presentation: {
          searchCandidateIds: ["unit-1", "unit-2"],
          selectedProjectId: "proj-123",
          awaitingConfirmation: true,
        },
      };

      const result = validateIntent(raw);

      assert.equal(result.presentation?.selectedProjectId, "proj-123");
      assert.equal(result.presentation?.awaitingConfirmation, true);
    });

    it("should validate explicit constraint lifecycle operations and ranking objectives", () => {
      const result = validateIntent({
        language: "ar-EG",
        constraintOperations: [{ operation: "PRESERVE", constraint: "BUDGET" }],
        queryObjective: "CHEAPEST",
      });
      assert.equal(result.constraintOperations?.[0]?.constraint, "BUDGET");
      assert.equal(result.constraintOperations?.[0]?.operation, "PRESERVE");
      assert.equal(result.queryObjective, "CHEAPEST");
    });
  });

  describe("validateKnowledge", () => {
    it("should pass valid knowledge with all sections", () => {
      const raw = {
        overview: ["Project is a luxury compound"],
        developerInformation: ["Developed by Emaar"],
        location: ["Located in New Cairo"],
        amenities: ["Swimming pool", "Gym"],
        faqs: [{ question: "What is the delivery date?", answer: "Q4 2027" }],
        sourceLength: 15000,
      };

      const result = validateKnowledge(raw);

      assert.equal((result.overview as unknown[])?.[0], "Project is a luxury compound");
      assert.equal((result.amenities as unknown[])?.length, 2);
      assert.equal(result.sourceLength, 15000);
    });

    it("should accept passthrough fields not explicitly listed", () => {
      const raw = {
        overview: ["Overview text"],
        customField: "custom value",
        anotherField: 123,
      };

      const result = validateKnowledge(raw);

      assert.equal((result.overview as unknown[])?.[0], "Overview text");
      assert.equal(result.customField, "custom value");
      assert.equal(result.anotherField, 123);
    });

    it("should return fallback on validation failure", () => {
      const raw = {
        overview: "string instead of array", // wrong type
      };

      const logger = {
        warn: (msg: string) => {
          assert.match(msg, /Knowledge extraction validation failed/);
        },
      };

      const result = validateKnowledge(raw, logger);

      assert.equal(result.extractionUnavailable, true);
      assert.equal(result.notes, "Validation failed, manual review required");
    });
  });

  describe("validateColumnMappings", () => {
    it("should pass valid column mappings", () => {
      const raw = [
        {
          sourceColumn: "Price (EGP)",
          canonicalField: "price",
          confidence: 0.95,
          explanation: "Direct price field",
        },
        {
          sourceColumn: "Area",
          canonicalField: "builtUpArea",
          confidence: 0.8,
        },
      ];

      const result = validateColumnMappings(raw);

      assert.equal(result.length, 2);
      assert.equal(result[0].sourceColumn, "Price (EGP)");
      assert.equal(result[0].canonicalField, "price");
      assert.equal(result[0].confidence, 0.95);
      assert.equal(result[1].confidence, 0.8);
    });

    it("should reject confidence > 1", () => {
      const raw = [
        {
          sourceColumn: "Price",
          canonicalField: "price",
          confidence: 1.5, // invalid
        },
      ];

      const logger = {
        warn: (msg: string) => {
          assert.match(msg, /Column mapping validation failed/);
        },
      };

      const result = validateColumnMappings(raw, logger);

      assert.equal(result.length, 0);
    });

    it("should reject confidence < 0", () => {
      const raw = [
        {
          sourceColumn: "Price",
          canonicalField: "price",
          confidence: -0.1,
        },
      ];

      const logger = {
        warn: (msg: string) => {
          assert.match(msg, /Column mapping validation failed/);
        },
      };

      const result = validateColumnMappings(raw, logger);

      assert.equal(result.length, 0);
    });

    it("should return empty array on non-array input", () => {
      const raw = {
        sourceColumn: "Price",
        canonicalField: "price",
        confidence: 0.9,
      };

      const logger = {
        warn: (msg: string) => {
          assert.match(msg, /Column mapping validation failed/);
        },
      };

      const result = validateColumnMappings(raw, logger);

      assert.equal(result.length, 0);
    });
  });
});
