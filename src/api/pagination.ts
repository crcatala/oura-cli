import type { OuraApiResponse } from "../types.js";
import { CliError } from "../utils/errors.js";

export type PageFetcher<T> = (nextToken?: string) => Promise<OuraApiResponse<T>>;

export interface CollectOptions {
  /** Hard cap on pages to prevent unbounded loops. */
  maxPages?: number;
  /** Cap on total items returned (0 = unlimited). */
  maxItems?: number;
}

const DEFAULT_MAX_PAGES = 50;

/**
 * Loop the `next_token` cursor until exhausted. Oura's cursor is an opaque
 * string; an empty/absent next_token means the end of the collection.
 */
export async function collectPages<T>(
  fetcher: PageFetcher<T>,
  opts: CollectOptions = {},
): Promise<T[]> {
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const maxItems = opts.maxItems ?? 0;
  const all: T[] = [];
  let next: string | undefined;
  let pages = 0;

  do {
    if (pages >= maxPages) {
      throw new CliError(`Pagination exceeded ${maxPages} pages — refine your date range`);
    }
    const page = await fetcher(next);
    pages += 1;
    all.push(...page.data);
    next = page.next_token && page.next_token.length > 0 ? page.next_token : undefined;
    if (maxItems > 0 && all.length >= maxItems) break;
  } while (next);

  return all.slice(0, maxItems > 0 ? maxItems : undefined);
}
