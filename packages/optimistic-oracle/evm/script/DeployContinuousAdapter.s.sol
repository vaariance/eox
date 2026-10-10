// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {EoxContinuousAdapter} from "../src/EoxContinuousAdapter.sol";
import {IOptimisticOracleV3} from "../src/interfaces/IOptimisticOracleV3.sol";
import {IWormhole} from "../src/interfaces/IWormhole.sol";

contract DeployContinuousAdapter is Script {
    address constant SEPOLIA_OOV3 = 0xFd9e2642a170aDD10F53Ee14a93FcF2F31924944;
    address constant SEPOLIA_WORMHOLE = 0x4a8bc80Ed5a4067f1CCf107057b8270E0cC11A78;
    address constant SEPOLIA_WETH = 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9;
    address constant DEV_UMA_ASSERTER = 0x70bA88a9f3c35aa2E07aBFa74A487A2410553634;

    error MissingDestination();

    function run() external returns (EoxContinuousAdapter adapter) {
        address oracle = vm.envOr("OOV3", SEPOLIA_OOV3);
        address wormhole = vm.envOr("WORMHOLE", SEPOLIA_WORMHOLE);
        address bondCurrency = vm.envOr("BOND_CURRENCY", SEPOLIA_WETH);
        address asserter = vm.envOr("ASSERTER", DEV_UMA_ASSERTER);
        bytes32 solanaProgram = vm.envBytes32("SOLANA_PROGRAM");
        bytes32 registry = vm.envBytes32("REGISTRY");
        if (solanaProgram == bytes32(0) || registry == bytes32(0)) revert MissingDestination();

        vm.startBroadcast();
        address owner = vm.envOr("OWNER", msg.sender);
        adapter = new EoxContinuousAdapter(
            IOptimisticOracleV3(oracle),
            IWormhole(wormhole),
            IERC20(bondCurrency),
            solanaProgram,
            registry,
            owner
        );
        bool asserterSet = asserter != address(0) && owner == msg.sender;
        if (asserterSet) adapter.setAsserter(asserter, true);
        vm.stopBroadcast();

        console.log("EoxContinuousAdapter", address(adapter));
        console.log("owner", owner);
        console.log("asserter", asserter, asserterSet ? "allowed" : "not set");
        console.log("bond currency", bondCurrency);
        console.log("minimum bond", IOptimisticOracleV3(oracle).getMinimumBond(bondCurrency));
        console.log("wormhole chain", adapter.wormholeChain());
        console.log("solana program");
        console.logBytes32(solanaProgram);
        console.log("registry");
        console.logBytes32(registry);
    }
}
