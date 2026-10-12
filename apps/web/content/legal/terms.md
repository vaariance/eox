# Relative — Devnet Terms of Use

**Last updated: 12 October 2026**

**Devnet policies are subject to review.** These Terms apply to Relative’s experimental devnet release. They do not authorize a mainnet or real-money service.

## 1. Who provides Relative

Relative is provided by **Variance Labs Ltd**, a private company limited by shares incorporated in Nigeria, registration number **RC 8384457** (“Variance Labs”, “we”, “us”). These Terms govern our Relative website, application, APIs and related services at getrelative.trade and its service subdomains (the “Services”). Contact us at **support@getrelative.trade**.

When you accept these Terms through the application, you enter into an agreement with Variance Labs. If you act for an organisation, you confirm you have authority to bind it. If you do not agree, do not connect a wallet or submit transactions through the Services.

## 2. An experimental service using test assets

Relative currently operates on **Solana devnet** for testing and evaluation. Devnet USDC, devnet SOL and Relative devnet positions are test assets. They do not represent a claim to real US dollars, mainnet USDC, actual BTC or other underlying assets, or payment by Variance Labs or Circle.

Do not send real funds or mainnet assets to devnet addresses. We do not promise to recover assets sent to an incorrect address, network or program.

Test balances, positions, results and history may be affected by bugs, program upgrades, network resets or the end of the experiment. Participation does not create an entitlement to future tokens, rewards, an airdrop, compensation or migration to a production service. Any future real-money release will require separate terms and applicable legal review.

## 3. Eligibility

You must be at least 18, legally able to enter this agreement, and permitted to use the Services where you are located. You must not use the Services in violation of applicable sanctions, court orders or other legal restrictions, or bypass access restrictions we implement to meet those requirements.

Availability of our website does not establish that a service is lawful in every jurisdiction. We may limit availability as legal requirements and the devnet release develop.

## 4. What a Relative position represents

Relative lets users test trading the performance of supported crypto assets against a shared, price-based crypto benchmark called **CRYPTO**. Positions are recorded by the COX program. They are not purchases of the named underlying coins, shares in Variance Labs, or ownership of the assets used to calculate the benchmark.

Users deposit supported test collateral, hold benchmark or asset-performance positions, switch between supported positions, and request redemption under the program’s rules. Changes in position value redistribute existing pool backing. The system is designed without borrowing or leveraged exposure.

A reference measures performance; it is not a guaranteed redemption price or promised return. Your result also depends on the pool’s accounting, allocation, available backing, fees and execution rules. A position can lose some or all of its test value. An asset’s dollar price rising does not necessarily mean it outperformed CRYPTO.

Published methodology and fee-policy documents explain the calculation rules. Describing this system as decentralized or fully collateralized does not establish a particular regulatory classification or remove its technical risks.

## 5. Wallets, smart contracts and operator controls

You approve user transactions through your wallet. We do not ask for your seed phrase or private keys. You are responsible for checking the network, program, permissions, amounts and transaction details before signing, and for keeping your wallet secure.

Deposited test collateral moves into a program-controlled vault; it does not remain in your wallet. Access to it then depends on the deployed program and its withdrawal rules.

Variance Labs retains administrative and upgrade controls in the devnet deployment. These include powers to pause relevant activity, upgrade the program, manage permitted configuration and schedule fees within program limits. Our infrastructure also supplies and publishes the price inputs used by the program. Publisher authority and administrative authority have different permissions. These controls mean the service is not independent of its operators.

We may exercise these controls for maintenance, security, testing or legal requirements. We will explain material planned changes through the Services where practicable; urgent action may occur before notice. Those powers do not permit us to disregard applicable law or these Terms.

## 6. Requests and execution

Submitting a trade reserves the necessary funds or units. A request can become eligible only at a future publication, never at the publication at which it was created. A target publication interval of one minute is not a promise that a request will fill within one minute.

An accepted batch fixes the execution values for its requests. Processing can span multiple transactions and continue beyond a minute. Staged outputs become available only when the batch finalizes. Network congestion, missing inputs, pauses or service failures may delay this process and later publications.

Quotes are estimates. Review minimum-output conditions, expiry and fees before signing. Minimum-output checks apply after trading fees. Expiry is assessed against the accepted batch under the program’s rules, rather than the eventual wall-clock completion time.

Cancellation, rejection, expiry, refunds and withdrawal are subject to request status and program conditions. Cancelling an eligible request is different from reversing a completed blockchain transaction. We cannot promise an immediate cancellation, withdrawal or recovery, particularly during an outage or unfinished batch.

## 7. Trading fees

The initial devnet trading policy charges **2 basis points (0.02%) per successful deposit, switch or redemption, capped at 2 devnet USDC per request**. Using six-decimal collateral units, the fee is the lesser of the configured cap and the gross collateral value multiplied by the basis-point rate and divided by 10,000, rounded down to a whole base unit. There is no minimum fee.

Deposits mint against the amount after fees. Switches deduct fees from the source value before calculating destination units. Redemptions credit net proceeds. Rejected, cancelled, expired or refunded requests incur no trading fee. Withdrawing an already available payable incurs no additional trading fee. Network fees and account-creation costs are separate and may arise even when a transaction fails.

Each request locks the active fee configuration when submitted. A changed configuration version requires a fresh submission using the correct version before funds are reserved. Retries do not create another trading fee for the same successful request.

The current program permits rates from 0 to 100 basis points and caps from 0 to 2 devnet USDC. Either setting at zero disables trading fees. Subsequent changes require at least 24 hours’ notice and take effect only when an eligible publication finalizes. A pending change may be cancelled or replaced under those rules; replacement restarts the notice period. Existing requests retain their locked terms.

The application should show the applicable rate, cap and estimated gross and net amounts before signing. Check those values rather than treating this description as a live quote. A change to this webpage alone does not change the program’s fee configuration.

## 8. Risks and information quality

The Services may contain software defects, inaccurate prices, calculation or display errors, stale data and unavailable components. External wallets, RPC providers, validators, price sources and hosting services can fail or be compromised. Published records and transaction confirmation may be delayed or inconsistent across providers.

Research papers, charts, test results and reference values are informational. They are not personal investment, legal or tax advice, a recommendation to buy an asset, a promise of profit, or evidence of regulatory approval. Independent testing does not eliminate smart-contract or operational risk.

## 9. Acceptable use

Do not use the Services to commit fraud, impersonate another person, access another user’s wallet, distribute malware, evade lawful restrictions, manipulate inputs, or deliberately disrupt shared infrastructure. Do not misrepresent test assets or test results as real financial entitlements.

Good-faith security research is welcome. Send findings privately to support@getrelative.trade, minimise access to other people’s data, and avoid destructive testing or interruption of shared services without written permission. Reporting a vulnerability does not by itself create a right to a bounty.

## 10. Content and third-party services

Our branding, interface and original content remain the property of Variance Labs or their respective owners. We permit you to use them as necessary to access the Services under these Terms. Separately licensed open-source code remains governed by its own licence. You retain ownership of your feedback and grant us permission to use it to improve Relative without an obligation to pay you; do not submit confidential material you are not authorised to share.

Wallets, faucets, explorers and other third-party services have their own terms. A link or integration does not make Variance Labs their operator or establish their endorsement of Relative.

## 11. Suspension and ending participation

You may stop using the Services and disconnect your wallet at any time. Disconnecting does not cancel pending requests, withdraw positions or erase public transactions. Those actions require the relevant program instructions when available.

We may restrict or discontinue the devnet Services for security, misuse, maintenance, legal requirements or completion of testing. Where reasonably practicable, we will give notice and explain available actions for pending requests and test positions. Interface access restrictions do not themselves reverse blockchain state.

## 12. Responsibility and limitations

To the extent permitted by law, the devnet Services are provided as available, without a guarantee of uninterrupted operation, accuracy, fitness for a particular purpose or preservation of test balances. We do not undertake to compensate the nominal value of test assets or hypothetical trading profits.

To the extent permitted by law, neither party is liable to the other for indirect or consequential losses, lost anticipated profits or lost business opportunities arising from this experimental service. Nothing here excludes liability for fraud, wilful misconduct, gross negligence, or any liability or remedy that applicable law does not permit us to exclude. Mandatory consumer and data-protection rights remain unaffected.

## 13. Privacy, changes and disputes

Our [Privacy Policy](relative-privacy.md) explains personal-data processing. Acknowledging it is not blanket consent to optional processing.

These devnet policies are subject to review. We will identify updated versions and give reasonable advance notice of material contractual changes where practicable. Where required, we will obtain renewed acceptance. Changes apply prospectively and do not retrospectively replace the fee terms locked by an existing request. Necessary urgent changes may apply sooner, with notice as soon as reasonably possible.

Nigerian law governs these Terms, subject to mandatory protections that apply to you. Please first contact support@getrelative.trade so we can try to resolve a concern. This does not prevent urgent relief, a regulatory complaint or the exercise of statutory rights. Disputes may be brought before the competent courts of Nigeria, without removing any mandatory right to bring proceedings elsewhere.

If a provision is unenforceable, the remaining provisions continue so far as legally possible. A failure to enforce a provision on one occasion is not a waiver of it.

**Contact: Variance Labs Ltd · RC 8384457 · support@getrelative.trade**
