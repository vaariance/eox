// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IWormhole} from "../../src/interfaces/IWormhole.sol";

contract MockWormhole is IWormhole {
    struct Published {
        address emitter;
        uint32 nonce;
        bytes payload;
        uint8 consistencyLevel;
        uint256 fee;
    }

    uint256 public fee;
    uint16 public chainId = 10_002;
    Published[] public published;

    function setFee(uint256 fee_) external {
        fee = fee_;
    }

    function setChainId(uint16 chainId_) external {
        chainId = chainId_;
    }

    function publishMessage(uint32 nonce, bytes memory payload, uint8 consistencyLevel)
        external
        payable
        returns (uint64 sequence)
    {
        require(msg.value == fee, "wrong fee");
        published.push(
            Published({
                emitter: msg.sender,
                nonce: nonce,
                payload: payload,
                consistencyLevel: consistencyLevel,
                fee: msg.value
            })
        );
        return uint64(published.length - 1);
    }

    function messageFee() external view returns (uint256) {
        return fee;
    }

    function count() external view returns (uint256) {
        return published.length;
    }

    function payloadAt(uint256 i) external view returns (bytes memory) {
        return published[i].payload;
    }
}
