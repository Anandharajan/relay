/** A job failure that retrying cannot fix (missing key, rejected request): the queue gives up at once. */
export class PermanentError extends Error {
  readonly permanent = true;
}
