import { describe, expect, test } from "bun:test";
import { calculatePhysicalCountVariance } from "./physical-count-calculation";

describe("physical count variance", () => {
  test("calculates a signed shortage with fixed-decimal value", () => {
    expect(calculatePhysicalCountVariance({ cardQuantity: 10, physicalQuantity: 8, unitValue: "1250.00" })).toEqual({ quantity: -2, value: "-2500.00", status: "shortage" });
  });
  test("distinguishes unknown value from zero and calculates overages exactly", () => {
    expect(calculatePhysicalCountVariance({ cardQuantity: 1, physicalQuantity: 4, unitValue: null })).toEqual({ quantity: 3, value: null, status: "overage" });
    expect(calculatePhysicalCountVariance({ cardQuantity: 1, physicalQuantity: 4, unitValue: "0.00" })).toEqual({ quantity: 3, value: "0.00", status: "overage" });
    expect(calculatePhysicalCountVariance({ cardQuantity: 0, physicalQuantity: 3, unitValue: "0.10" }).value).toBe("0.30");
  });
  test("rejects invalid counts and currency", () => {
    expect(() => calculatePhysicalCountVariance({ cardQuantity: -1, physicalQuantity: 1, unitValue: null })).toThrow();
    expect(() => calculatePhysicalCountVariance({ cardQuantity: 0, physicalQuantity: 1, unitValue: "1.001" })).toThrow();
    expect(() => calculatePhysicalCountVariance({ cardQuantity: 0, physicalQuantity: 1, unitValue: "-1" })).toThrow();
  });
});
