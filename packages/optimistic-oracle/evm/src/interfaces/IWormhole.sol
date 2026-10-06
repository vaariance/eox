// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// The subset of the Wormhole core contract that EOX calls.
interface IWormhole {
    function publishMessage(uint32 nonce, bytes memory payload, uint8 consistencyLevel)
        external
        payable
        returns (uint64 sequence);

    function messageFee() external view returns (uint256);
}
