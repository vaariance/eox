// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IOptimisticOracleV3, IOptimisticOracleV3CallbackRecipient} from "../../src/interfaces/IOptimisticOracleV3.sol";

/// Stands in for UMA's Optimistic Oracle V3: takes the bond the way the real oracle does
/// (pulled from the caller) and lets a test decide when and how each assertion resolves.
contract MockOptimisticOracleV3 is IOptimisticOracleV3 {
    using SafeERC20 for IERC20;

    struct Recorded {
        bytes claim;
        address asserter;
        address callbackRecipient;
        address escalationManager;
        uint64 liveness;
        IERC20 currency;
        uint256 bond;
        bytes32 identifier;
        bytes32 domainId;
    }

    bytes32 public constant DEFAULT_IDENTIFIER = "ASSERT_TRUTH";
    uint256 public minimumBond;
    uint256 private _nonce;
    mapping(bytes32 => Recorded) public assertions;

    constructor(uint256 minimumBond_) {
        minimumBond = minimumBond_;
    }

    function assertTruth(
        bytes memory claim,
        address asserter,
        address callbackRecipient,
        address escalationManager,
        uint64 liveness,
        IERC20 currency,
        uint256 bond,
        bytes32 identifier,
        bytes32 domainId
    ) external returns (bytes32 assertionId) {
        require(bond >= minimumBond, "bond below minimum");
        currency.safeTransferFrom(msg.sender, address(this), bond);
        assertionId = keccak256(abi.encode(++_nonce, claim));
        assertions[assertionId] = Recorded(
            claim, asserter, callbackRecipient, escalationManager, liveness, currency, bond, identifier, domainId
        );
    }

    function defaultIdentifier() external pure returns (bytes32) {
        return DEFAULT_IDENTIFIER;
    }

    function getMinimumBond(address) external view returns (uint256) {
        return minimumBond;
    }

    function claimOf(bytes32 assertionId) external view returns (bytes memory) {
        return assertions[assertionId].claim;
    }

    /// What the real oracle does when liveness passes undisputed, or when the vote resolves.
    function resolve(bytes32 assertionId, bool truthful) external {
        IOptimisticOracleV3CallbackRecipient(assertions[assertionId].callbackRecipient)
            .assertionResolvedCallback(assertionId, truthful);
    }

    function dispute(bytes32 assertionId) external {
        IOptimisticOracleV3CallbackRecipient(assertions[assertionId].callbackRecipient)
            .assertionDisputedCallback(assertionId);
    }
}
