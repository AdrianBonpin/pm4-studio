import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginDeviceOperation,
  isDeviceBusy,
  resetDeviceOperationsForTest,
  subscribeDeviceBusy,
} from "./deviceLock";

afterEach(() => resetDeviceOperationsForTest());

describe("the device operation lock", () => {
  it("reports the Reader busy for exactly as long as the operation runs", () => {
    expect(isDeviceBusy()).toBe(false);
    const release = beginDeviceOperation();
    expect(isDeviceBusy()).toBe(true);
    release();
    expect(isDeviceBusy()).toBe(false);
  });

  it("ignores a second release, so a double finally cannot free someone else's hold", () => {
    const release = beginDeviceOperation();
    release();
    release();
    expect(isDeviceBusy()).toBe(false);

    const first = beginDeviceOperation();
    const second = beginDeviceOperation();
    first();
    expect(isDeviceBusy()).toBe(true);
    second();
    expect(isDeviceBusy()).toBe(false);
  });

  it("tells listeners when the flag changes, and stops when they unsubscribe", () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeDeviceBusy(() => seen.push(isDeviceBusy()));

    const release = beginDeviceOperation();
    release();
    expect(seen).toEqual([true, false]);

    unsubscribe();
    const again = beginDeviceOperation();
    again();
    expect(seen).toEqual([true, false]);
  });

  it("does not let one listener throwing stop the others or the operation", () => {
    const seen = vi.fn();
    const unsubscribeBroken = subscribeDeviceBusy(() => {
      throw new Error("listener failed");
    });
    const unsubscribeGood = subscribeDeviceBusy(seen);

    // A broken listener must not break the write that is announcing itself.
    const release = beginDeviceOperation();
    expect(() => release()).not.toThrow();
    expect(seen).toHaveBeenCalledTimes(2);
    expect(isDeviceBusy()).toBe(false);

    unsubscribeBroken();
    unsubscribeGood();
  });
});
