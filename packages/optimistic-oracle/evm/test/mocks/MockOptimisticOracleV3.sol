// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IOptimisticOracleV3, IOptimisticOracleV3CallbackRecipient} from "../../src/interfaces/IOptimisticOracleV3.sol";

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
    mapping(bytes32 => IOptimisticOracleV3.Assertion) private _state;
    mapping(bytes32 => bool) public voted;
    mapping(bytes32 => bool) public vote;

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
        assertionId = keccak256(abi.encode(++_nonce));
        assertions[assertionId] = Recorded({
            claim: claim,
            asserter: asserter,
            callbackRecipient: callbackRecipient,
            escalationManager: escalationManager,
            liveness: liveness,
            currency: currency,
            bond: bond,
            identifier: identifier,
            domainId: domainId
        });
        IOptimisticOracleV3.Assertion storage state = _state[assertionId];
        state.escalationManagerSettings.assertingCaller = msg.sender;
        state.escalationManagerSettings.escalationManager = escalationManager;
        state.asserter = asserter;
        state.assertionTime = uint64(block.timestamp);
        state.currency = currency;
        state.expirationTime = uint64(block.timestamp) + liveness;
        state.domainId = domainId;
        state.identifier = identifier;
        state.bond = bond;
        state.callbackRecipient = callbackRecipient;
    }

    function getAssertion(bytes32 assertionId)
        external
        view
        returns (IOptimisticOracleV3.Assertion memory)
    {
        return _state[assertionId];
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

    function setVote(bytes32 assertionId, bool truthful) external {
        voted[assertionId] = true;
        vote[assertionId] = truthful;
    }

    function settleAssertion(bytes32 assertionId) external {
        IOptimisticOracleV3.Assertion storage state = _state[assertionId];
        require(state.asserter != address(0), "Assertion does not exist");
        require(!state.settled, "Assertion already settled");
        bool truthful = true;
        if (state.disputer == address(0)) {
            require(state.expirationTime <= block.timestamp, "Assertion not expired");
        } else {
            require(voted[assertionId], "Price not resolved");
            truthful = vote[assertionId];
        }
        state.settled = true;
        state.settlementResolution = truthful;
        IOptimisticOracleV3CallbackRecipient(state.callbackRecipient)
            .assertionResolvedCallback(assertionId, truthful);
    }

    function resolve(bytes32 assertionId, bool truthful) external {
        _state[assertionId].settled = true;
        _state[assertionId].settlementResolution = truthful;
        IOptimisticOracleV3CallbackRecipient(assertions[assertionId].callbackRecipient)
            .assertionResolvedCallback(assertionId, truthful);
    }

    function dispute(bytes32 assertionId) external {
        _state[assertionId].disputer = msg.sender;
        IOptimisticOracleV3CallbackRecipient(assertions[assertionId].callbackRecipient)
            .assertionDisputedCallback(assertionId);
    }
}
