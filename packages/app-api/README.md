# @eox/app-api (Joel)

The versioned schema (`cox.app-api/v1`) and typed client for the COX app API. The
web app imports this package; the service is `apps/app-api`, where the routes,
error codes and fixture are documented.

```ts
import { createCoxApiClient } from "@eox/app-api";

const api = createCoxApiClient({ baseUrl: "http://127.0.0.1:8790" });
const { data, status, deployment } = await api.latestPublication();
const stream = api.subscribePublications(null, (event) => { /* new publication */ });
```

Every integer is a decimal string: parse with `BigInt`, never `Number`. Prices are
USD × 10⁸ (`COX_PRICE_SCALE`); the benchmark and references are at 10¹²
(`COX_SCALE`), so a reference of 100 is `COX_REFERENCE_BASE`; units are quanta at
10¹² per unit; collateral is in base units. `batchFor(now, origin)` gives the batch a
request submitted now targets (`floor((t − origin) / 60) + 1`) and its +55 s
acceptance deadline. A reference is not a claim value, and MVP-0 is a test
mechanism on test collateral.
