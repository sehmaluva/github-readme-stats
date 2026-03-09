// @ts-check

import { CustomError } from "./error.js";
import { logger } from "./log.js";

// Script variables.

// Count the number of GitHub API tokens available.
const PATs = Object.keys(process.env).filter((key) =>
  /PAT_\d*$/.exec(key),
).length;
const RETRIES = process.env.NODE_ENV === "test" ? 7 : PATs;

/**
 * @typedef {import("axios").AxiosResponse} AxiosResponse Axios response.
 * @typedef {(variables: any, token: string, retriesForTests?: number) => Promise<AxiosResponse>} FetcherFunction Fetcher function.
 */

/**
 * Try to execute the fetcher function until it succeeds or the max number of retries is reached.
 *
 * @param {FetcherFunction} fetcher The fetcher function.
 * @param {any} variables Object with arguments to pass to the fetcher function.
 * @param {number} retries How many times to retry.
 * @param {boolean} hasRateLimitFailure Whether any previous attempt was rate limited (internal use).
 * @returns {Promise<any>} The response from the fetcher function.
 */
const retryer = async (
  fetcher,
  variables,
  retries = 0,
  hasRateLimitFailure = false,
) => {
  if (!RETRIES) {
    throw new CustomError("No GitHub API tokens found", CustomError.NO_TOKENS);
  }

  if (retries >= RETRIES) {
    // If no rate limit failures occurred, all PATs had bad credentials/were suspended.
    if (!hasRateLimitFailure) {
      throw new CustomError(
        "GitHub token(s) are invalid or expired",
        CustomError.BAD_CREDENTIALS,
      );
    }
    throw new CustomError(
      "Downtime due to GitHub API rate limiting",
      CustomError.MAX_RETRY,
    );
  }

  try {
    // retries is 0-indexed; PAT_1 corresponds to retries=0, PAT_N to retries=N-1
    let response = await fetcher(
      variables,
      // @ts-ignore
      process.env[`PAT_${retries + 1}`],
      // used in tests for faking rate limit
      retries,
    );

    // react on both type and message-based rate-limit signals.
    // https://github.com/sehmaluva/github-readme-stats/issues/4425
    const errors = response?.data?.errors;
    const errorType = errors?.[0]?.type;
    const errorMsg = errors?.[0]?.message || "";
    const isRateLimited =
      (errors && errorType === "RATE_LIMITED") || /rate limit/i.test(errorMsg);

    // if rate limit is hit increase the RETRIES and recursively call the retryer
    // with username, and current RETRIES
    if (isRateLimited) {
      logger.log(`PAT_${retries + 1} Failed`);
      // directly return from the function
      return retryer(fetcher, variables, retries + 1, true);
    }

    // finally return the response
    return response;
  } catch (err) {
    /** @type {any} */
    const e = err;

    // network/unexpected error → let caller treat as failure
    if (!e?.response) {
      throw e;
    }

    // prettier-ignore
    // also checking for bad credentials if any tokens gets invalidated
    const isBadCredential =
      e?.response?.data?.message === "Bad credentials";
    const isAccountSuspended =
      e?.response?.data?.message === "Sorry. Your account was suspended.";

    // Handle HTTP 403 rate limit responses from the GitHub REST API.
    // GitHub returns 403 (not 429) for primary and secondary rate limits on the REST API.
    const isRestRateLimited =
      e?.response?.status === 403 &&
      /rate limit/i.test(e?.response?.data?.message || "");

    if (isBadCredential || isAccountSuspended) {
      logger.log(`PAT_${retries + 1} Failed`);
      // directly return from the function, preserving the hasRateLimitFailure state
      return retryer(fetcher, variables, retries + 1, hasRateLimitFailure);
    }

    if (isRestRateLimited) {
      logger.log(`PAT_${retries + 1} Failed`);
      // directly return from the function, marking a rate limit failure
      return retryer(fetcher, variables, retries + 1, true);
    }

    // HTTP error with a response → return it for caller-side handling
    return e.response;
  }
};

export { retryer, RETRIES };
export default retryer;
