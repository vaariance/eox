/** Retry transport availability failures only; readiness, conflicts and program errors surface. */
export function retryDelay(error: unknown, failures: number): number | null {
  const message = error instanceof Error ? error.message : String(error);
  if (/Oracle ?paused/i.test(message)) return 30_000;
  if (/MissingPublication|Invalid|Conflict|Mismatch|Incomplete|Unexpected|ExcessPrecision|OutOfRange|HistoryChanged/.test(message)) return null;
  if (!/fetch failed|network|timeout|timed out|ECONN|ENOTFOUND|EAI_AGAIN|socket|429|503|502|504|Too Many Requests|blockhash not found|TransactionExpired|Blockhash not found/i.test(message)) return null;
  return Math.min(30_000, 1_000 * 2 ** Math.min(Math.max(failures, 1), 5));
}
