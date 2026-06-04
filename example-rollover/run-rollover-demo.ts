import { existsSync, readFileSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
	initChain,
	appendBlock,
	verifyChain,
	getChainStatus,
	rolloverChain,
	GENESIS_PREV_HASH,
} from "../../packablock-client/src/chain.ts";
import { getPackageDiff } from "../../packablock-client/src/diff.ts";

const colors = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
	gray: "\x1b[90m",
};

function getMockLocations(packages: Record<string, string>): Record<string, { line: number; column: number }> {
	const locations: Record<string, { line: number; column: number }> = {};
	const keys = Object.keys(packages);
	for (let idx = 0; idx < keys.length; idx++) {
		const name = keys[idx];
		locations[name] = {
			line: (idx + 1) * 3 + 1,
			column: 10,
		};
	}
	return locations;
}

function getConstraintsAtDate(dateStr: string, history: any[]): Record<string, string> {
	let activeConstraints: Record<string, string> = {};
	const targetTime = new Date(dateStr).getTime();
	
	for (const entry of history) {
		const entryTime = new Date(entry.date).getTime();
		if (entryTime <= targetTime) {
			activeConstraints = entry.constraints;
		} else {
			break;
		}
	}
	return activeConstraints;
}

async function run() {
	const chainPath = path.resolve(__dirname, "packablock.yaml");

	console.log(`${colors.bold}${colors.cyan}============================================================${colors.reset}`);
	console.log(`${colors.bold}${colors.cyan}🔄 Starting Packablock Rollover Simulation Test...${colors.reset}`);
	console.log(`${colors.bold}${colors.cyan}============================================================${colors.reset}\n`);

	// 1. Cleanup
	rmSync(chainPath, { force: true });
	const files = readdirSync(__dirname);
	for (const file of files) {
		if (file.startsWith("packablock-") && file.endsWith(".yaml")) {
			rmSync(path.join(__dirname, file), { force: true });
		}
	}

	// 2. Load chronological package.json constraints history and pre-rollover package history feed
	const packageJsonHistory = JSON.parse(
		readFileSync(path.resolve(__dirname, "package-json-history.json"), "utf8")
	);
	const cargoHistory = JSON.parse(
		readFileSync(path.resolve(__dirname, "cargo-toml-history.json"), "utf8")
	);
	const bunfigHistory = JSON.parse(
		readFileSync(path.resolve(__dirname, "bunfig-toml-history.json"), "utf8")
	);
	const tsconfigHistory = JSON.parse(
		readFileSync(path.resolve(__dirname, "tsconfig-json-history.json"), "utf8")
	);
	const bunTypesHistory = JSON.parse(
		readFileSync(path.resolve(__dirname, "bun-types-history.json"), "utf8")
	);
	const typesBunHistory = JSON.parse(
		readFileSync(path.resolve(__dirname, "types-bun-history.json"), "utf8")
	);

	const preRolloverFeed = JSON.parse(
		readFileSync(path.resolve(__dirname, "bun-pre-rollover-packages.json"), "utf8"),
	);

	console.log(`🎬 1. Replaying ${preRolloverFeed.length} ancient (pre-rollover) commits...`);

	let currentPackages: Record<string, string> = {};
	let currentConstraints: Record<string, string> = {};
	let currentCargo: Record<string, string> = {};
	let currentBunfig: Record<string, string> = {};
	let currentTsconfig: Record<string, string> = {};
	let currentBunTypes: Record<string, string> = {};
	let currentTypesBun: Record<string, string> = {};

	for (let i = 0; i < preRolloverFeed.length; i++) {
		const commit = preRolloverFeed[i];
		const rawPackages = commit.packages;
		const mockLocations = getMockLocations(rawPackages);
		const blockConstraints = getConstraintsAtDate(commit.date, packageJsonHistory);
		const blockCargo = getConstraintsAtDate(commit.date, cargoHistory);
		const blockBunfig = getConstraintsAtDate(commit.date, bunfigHistory);
		const blockTsconfig = getConstraintsAtDate(commit.date, tsconfigHistory);
		const blockBunTypes = getConstraintsAtDate(commit.date, bunTypesHistory);
		const blockTypesBun = getConstraintsAtDate(commit.date, typesBunHistory);

		let blockData = "";
		if (i === 0) {
			const payload: any = {
				"package.json": {
					chain_event: "init",
					constraints: Object.entries(blockConstraints).map(([name, val]) => ({ [name]: val })),
				},
				"Cargo.toml": {
					chain_event: "init",
					constraints: Object.entries(blockCargo).map(([name, val]) => ({ [name]: val })),
				},
				"bunfig.toml": {
					chain_event: "init",
					constraints: Object.entries(blockBunfig).map(([name, val]) => ({ [name]: val })),
				},
				"tsconfig.json": {
					chain_event: "init",
					constraints: Object.entries(blockTsconfig).map(([name, val]) => ({ [name]: val })),
				},
				"packages/bun-types/package.json": {
					chain_event: "init",
					constraints: Object.entries(blockBunTypes).map(([name, val]) => ({ [name]: val })),
				},
				"packages/@types/bun/package.json": {
					chain_event: "init",
					constraints: Object.entries(blockTypesBun).map(([name, val]) => ({ [name]: val })),
				},
				lockfiles: {
					"bun.lock": {
						chain_event: "init",
						packages: Object.entries(rawPackages).map(([name, ver]) => ({ [name]: ver })),
					}
				}
			};
			blockData = YAML.stringify(payload);
		} else {
			const lockfileDiff = getPackageDiff(currentPackages, rawPackages, mockLocations);
			const constraintsDiff = getPackageDiff(currentConstraints, blockConstraints);
			const cargoDiff = getPackageDiff(currentCargo, blockCargo);
			const bunfigDiff = getPackageDiff(currentBunfig, blockBunfig);
			const tsconfigDiff = getPackageDiff(currentTsconfig, blockTsconfig);
			const bunTypesDiff = getPackageDiff(currentBunTypes, blockBunTypes);
			const typesBunDiff = getPackageDiff(currentTypesBun, blockTypesBun);

			const payload: any = {
				lockfiles: {
					"bun.lock": {
						packages: lockfileDiff,
					}
				}
			};
			if (constraintsDiff.length > 0) {
				payload["package.json"] = { constraints: constraintsDiff };
			}
			if (cargoDiff.length > 0) {
				payload["Cargo.toml"] = { constraints: cargoDiff };
			}
			if (bunfigDiff.length > 0) {
				payload["bunfig.toml"] = { constraints: bunfigDiff };
			}
			if (tsconfigDiff.length > 0) {
				payload["tsconfig.json"] = { constraints: tsconfigDiff };
			}
			if (bunTypesDiff.length > 0) {
				payload["packages/bun-types/package.json"] = { constraints: bunTypesDiff };
			}
			if (typesBunDiff.length > 0) {
				payload["packages/@types/bun/package.json"] = { constraints: typesBunDiff };
			}
			blockData = YAML.stringify(payload);
		}

		const customMeta = {
			timestamp: commit.date,
		};

		if (i === 0) {
			await initChain(chainPath, blockData, GENESIS_PREV_HASH, customMeta);
		} else {
			await appendBlock(chainPath, blockData, customMeta);
		}

		currentPackages = rawPackages;
		currentConstraints = blockConstraints;
		currentCargo = blockCargo;
		currentBunfig = blockBunfig;
		currentTsconfig = blockTsconfig;
		currentBunTypes = blockBunTypes;
		currentTypesBun = blockTypesBun;
	}

	// 3. Verify pre-rollover chain
	let preStatus = await getChainStatus(chainPath);
	let preVerification = await verifyChain(chainPath);
	if (!preVerification.valid || preStatus.blockCount !== preRolloverFeed.length) {
		throw new Error(
			`❌ Pre-rollover chain validation failed: block count mismatch or invalid chain structure (healthy=${preVerification.valid})`,
		);
	}
	console.log(
		`   ${colors.green}✓ Success: Pre-rollover chain successfully created with ${preStatus.blockCount} blocks!${colors.reset}`,
	);
	console.log(`   ${colors.gray}└─ Latest Hash: ${preStatus.lastBlock?.meta_hash}${colors.reset}\n`);

	// 4. Perform cryptographic rollover
	console.log(`🔑 2. Performing cryptographic rollover coordination locally...`);
	const rolloverResult = await rolloverChain(chainPath);
	console.log(`   ${colors.green}✓ Success: Rollover complete!${colors.reset}`);
	console.log(`   ${colors.gray}├─ Backup saved to: ${path.basename(rolloverResult.backupPath)}${colors.reset}`);
	console.log(`   ${colors.gray}├─ Legacy chain hash: ${rolloverResult.prevMetaHash}${colors.reset}`);
	console.log(`   ${colors.gray}└─ New genesis hash:  ${rolloverResult.newGenesisHash}${colors.reset}\n`);

	// Verify rollover genesis block is linked to the backup hash
	const rolloverStatus = await getChainStatus(chainPath);
	if (
		rolloverStatus.blockCount !== 1 ||
		rolloverStatus.lastBlock?.prev_meta_hash !== rolloverResult.prevMetaHash
	) {
		throw new Error("❌ Rollover chain validation failed: link mismatch or incorrect block count.");
	}

	// 5. Load post-rollover package history feed
	const postRolloverFeed = JSON.parse(
		readFileSync(path.resolve(__dirname, "bun-post-rollover-packages.json"), "utf8"),
	);

	console.log(`🚀 3. Replaying ${postRolloverFeed.length} modern (post-rollover) commits...`);

	for (let i = 0; i < postRolloverFeed.length; i++) {
		const commit = postRolloverFeed[i];
		const rawPackages = commit.packages;
		const mockLocations = getMockLocations(rawPackages);
		const blockConstraints = getConstraintsAtDate(commit.date, packageJsonHistory);
		const blockCargo = getConstraintsAtDate(commit.date, cargoHistory);
		const blockBunfig = getConstraintsAtDate(commit.date, bunfigHistory);
		const blockTsconfig = getConstraintsAtDate(commit.date, tsconfigHistory);
		const blockBunTypes = getConstraintsAtDate(commit.date, bunTypesHistory);
		const blockTypesBun = getConstraintsAtDate(commit.date, typesBunHistory);

		const lockfileDiff = getPackageDiff(currentPackages, rawPackages, mockLocations);
		const constraintsDiff = getPackageDiff(currentConstraints, blockConstraints);
		const cargoDiff = getPackageDiff(currentCargo, blockCargo);
		const bunfigDiff = getPackageDiff(currentBunfig, blockBunfig);
		const tsconfigDiff = getPackageDiff(currentTsconfig, blockTsconfig);
		const bunTypesDiff = getPackageDiff(currentBunTypes, blockBunTypes);
		const typesBunDiff = getPackageDiff(currentTypesBun, blockTypesBun);
		
		const payload: any = {
			lockfiles: {
				"bun.lock": {
					packages: lockfileDiff,
				}
			}
		};
		if (constraintsDiff.length > 0) {
			payload["package.json"] = { constraints: constraintsDiff };
		}
		if (cargoDiff.length > 0) {
			payload["Cargo.toml"] = { constraints: cargoDiff };
		}
		if (bunfigDiff.length > 0) {
			payload["bunfig.toml"] = { constraints: bunfigDiff };
		}
		if (tsconfigDiff.length > 0) {
			payload["tsconfig.json"] = { constraints: tsconfigDiff };
		}
		if (bunTypesDiff.length > 0) {
			payload["packages/bun-types/package.json"] = { constraints: bunTypesDiff };
		}
		if (typesBunDiff.length > 0) {
			payload["packages/@types/bun/package.json"] = { constraints: typesBunDiff };
		}
		const blockData = YAML.stringify(payload);

		const customMeta = {
			timestamp: commit.date,
		};

		await appendBlock(chainPath, blockData, customMeta);
		currentPackages = rawPackages;
		currentConstraints = blockConstraints;
		currentCargo = blockCargo;
		currentBunfig = blockBunfig;
		currentTsconfig = blockTsconfig;
		currentBunTypes = blockBunTypes;
		currentTypesBun = blockTypesBun;
	}

	// 5.5. Append a final block representing the latest state to capture Cargo and other manifests constraints
	console.log(`📝 4. Appending final workspace block to anchor all latest manifest constraints...`);
	const latestCargo = cargoHistory[cargoHistory.length - 1]?.constraints || {};
	const latestBunfig = bunfigHistory[bunfigHistory.length - 1]?.constraints || {};
	const latestTsconfig = tsconfigHistory[tsconfigHistory.length - 1]?.constraints || {};
	const latestBunTypes = bunTypesHistory[bunTypesHistory.length - 1]?.constraints || {};
	const latestTypesBun = typesBunHistory[typesBunHistory.length - 1]?.constraints || {};

	const cargoDiff = getPackageDiff(currentCargo, latestCargo);
	const bunfigDiff = getPackageDiff(currentBunfig, latestBunfig);
	const tsconfigDiff = getPackageDiff(currentTsconfig, latestTsconfig);
	const bunTypesDiff = getPackageDiff(currentBunTypes, latestBunTypes);
	const typesBunDiff = getPackageDiff(currentTypesBun, latestTypesBun);

	const finalPayload: any = {
		lockfiles: {
			"bun.lock": {
				packages: [],
			}
		}
	};
	if (cargoDiff.length > 0) finalPayload["Cargo.toml"] = { constraints: cargoDiff };
	if (bunfigDiff.length > 0) finalPayload["bunfig.toml"] = { constraints: bunfigDiff };
	if (tsconfigDiff.length > 0) finalPayload["tsconfig.json"] = { constraints: tsconfigDiff };
	if (bunTypesDiff.length > 0) finalPayload["packages/bun-types/package.json"] = { constraints: bunTypesDiff };
	if (typesBunDiff.length > 0) finalPayload["packages/@types/bun/package.json"] = { constraints: typesBunDiff };

	const finalBlockData = YAML.stringify(finalPayload);
	await appendBlock(chainPath, finalBlockData, { timestamp: "2026-06-04T07:00:00Z" });

	// 6. Verify final modern chain and backup chain
	let postStatus = await getChainStatus(chainPath);
	let postVerification = await verifyChain(chainPath);
	let backupVerification = await verifyChain(rolloverResult.backupPath);

	if (!postVerification.valid || !backupVerification.valid) {
		throw new Error("❌ Final chain verification failed.");
	}

	// Modern chain should have: 1 genesis rollover block + 17 commits + 1 final block = 19 blocks
	const expectedBlocksCount = postRolloverFeed.length + 2;
	if (postStatus.blockCount !== expectedBlocksCount) {
		throw new Error(
			`❌ Expected modern chain to have ${expectedBlocksCount} blocks, got ${postStatus.blockCount}`,
		);
	}

	console.log(`   ${colors.green}✓ Success: Modern post-rollover chain created!${colors.reset}`);
	console.log(`   ${colors.gray}├─ Total Blocks: ${postStatus.blockCount}${colors.reset}`);
	console.log(`   ${colors.gray}└─ Latest Hash: ${postStatus.lastBlock?.meta_hash}${colors.reset}\n`);

	console.log(`${colors.bold}${colors.green}============================================================${colors.reset}`);
	console.log(`${colors.bold}${colors.green}🎉 SUCCESS: Rollover and Replay Simulation Test Passed!${colors.reset}`);
	console.log(`${colors.bold}${colors.green}============================================================${colors.reset}`);
}

run().catch((err) => {
	console.error(`\n❌ Test Failed: ${err.message}`);
	process.exit(1);
});
