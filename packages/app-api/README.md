# @eox/app-api (Joel)

The versioned schema (`eox.app-api/v1`) and typed client for the EOX app API. The
UI imports this package; the service is `apps/app-api`, where the endpoints, error
codes and fixture are documented.

All index values are integer strings at scale 1,000,000 (`FIXED_POINT_SCALE`);
parse them with `BigInt`, never `Number`. Execution must use the `snapshotId` the
response came from, and `status.eligibleForExecution` is false when no reference is
accepted or the latest one is older than `STALE_AFTER_SECONDS` (three hours).
