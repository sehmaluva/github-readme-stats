// @ts-check

import { describe, expect, it, jest } from "@jest/globals";
import "@testing-library/jest-dom";
import { RETRIES, retryer } from "../src/common/retryer.js";
import { logger } from "../src/common/log.js";

const fetcher = jest.fn((variables, token) => {
  logger.log(variables, token);
  return new Promise((res) => res({ data: "ok" }));
});

const fetcherFail = jest.fn(() => {
  return new Promise((res) =>
    res({ data: { errors: [{ type: "RATE_LIMITED" }] } }),
  );
});

const fetcherFailOnSecondTry = jest.fn((_vars, _token, retries) => {
  return new Promise((res) => {
    // faking rate limit
    // @ts-ignore
    if (retries < 1) {
      return res({ data: { errors: [{ type: "RATE_LIMITED" }] } });
    }
    return res({ data: "ok" });
  });
});

const fetcherFailWithMessageBasedRateLimitErr = jest.fn(
  (_vars, _token, retries) => {
    return new Promise((res) => {
      // faking rate limit
      // @ts-ignore
      if (retries < 1) {
        return res({
          data: {
            errors: [
              {
                type: "ASDF",
                message: "API rate limit already exceeded for user ID 11111111",
              },
            ],
          },
        });
      }
      return res({ data: "ok" });
    });
  },
);

const fetcherFailWithBadCredentials = jest.fn(() => {
  return new Promise((_res, rej) =>
    rej({ response: { data: { message: "Bad credentials" } } }),
  );
});

const fetcherFailWithRestRateLimit = jest.fn(() => {
  return new Promise((_res, rej) =>
    rej({
      response: {
        status: 403,
        data: { message: "API rate limit exceeded for user ID 12345678." },
      },
    }),
  );
});

const fetcherFailWithRestRateLimitThenSuccess = jest.fn(
  (_vars, _token, retries) => {
    return new Promise((res, rej) => {
      // @ts-ignore
      if (retries < 1) {
        return rej({
          response: {
            status: 403,
            data: {
              message: "API rate limit exceeded for user ID 12345678.",
            },
          },
        });
      }
      return res({ data: "ok" });
    });
  },
);

describe("Test Retryer", () => {
  it("retryer should return value and have zero retries on first try", async () => {
    let res = await retryer(fetcher, {});

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(res).toStrictEqual({ data: "ok" });
  });

  it("retryer should return value and have 2 retries", async () => {
    let res = await retryer(fetcherFailOnSecondTry, {});

    expect(fetcherFailOnSecondTry).toHaveBeenCalledTimes(2);
    expect(res).toStrictEqual({ data: "ok" });
  });

  it("retryer should return value and have 2 retries with message based rate limit error", async () => {
    let res = await retryer(fetcherFailWithMessageBasedRateLimitErr, {});

    expect(fetcherFailWithMessageBasedRateLimitErr).toHaveBeenCalledTimes(2);
    expect(res).toStrictEqual({ data: "ok" });
  });

  it("retryer should throw specific error if maximum retries reached", async () => {
    try {
      await retryer(fetcherFail, {});
    } catch (err) {
      expect(fetcherFail).toHaveBeenCalledTimes(RETRIES);
      // @ts-ignore
      expect(err.message).toBe("Downtime due to GitHub API rate limiting");
    }
  });

  it("retryer should throw bad credentials error when all PATs have bad credentials", async () => {
    try {
      await retryer(fetcherFailWithBadCredentials, {});
    } catch (err) {
      expect(fetcherFailWithBadCredentials).toHaveBeenCalledTimes(RETRIES);
      // @ts-ignore
      expect(err.message).toBe("GitHub token(s) are invalid or expired");
      // @ts-ignore
      expect(err.type).toBe("BAD_CREDENTIALS");
    }
  });

  it("retryer should retry and succeed after REST API HTTP 403 rate limit", async () => {
    let result = await retryer(fetcherFailWithRestRateLimitThenSuccess, {});

    expect(fetcherFailWithRestRateLimitThenSuccess).toHaveBeenCalledTimes(2);
    expect(result).toStrictEqual({ data: "ok" });
  });

  it("retryer should throw rate limit error when all PATs hit REST API HTTP 403 rate limit", async () => {
    try {
      await retryer(fetcherFailWithRestRateLimit, {});
    } catch (err) {
      expect(fetcherFailWithRestRateLimit).toHaveBeenCalledTimes(RETRIES);
      // @ts-ignore
      expect(err.message).toBe("Downtime due to GitHub API rate limiting");
    }
  });
});
