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

const colors = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
	gray: "\x1b[90m",
};

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

	// 2. Load pre-rollover package history feed
	const preRolloverFeed = JSON.parse(
		readFileSync(path.resolve(__dirname, "bun-pre-rollover-packages.json"), "utf8"),
	);

	console.log(`🎬 1. Replaying ${preRolloverFeed.length} ancient (pre-rollover) commits...`);

	for (let i = 0; i < preRolloverFeed.length; i++) {
		const commit = preRolloverFeed[i];
		// Sort packages alphabetically
		const sortedPackages: Record<string, string> = {};
		for (const key of Object.keys(commit.packages).sort()) {
			sortedPackages[key] = commit.packages[key];
		}

		const payloadObj = {
			commit: commit.sha,
			author: commit.author,
			date: commit.date,
			message: commit.message,
			packages: sortedPackages,
		};
		const blockData = YAML.stringify(payloadObj);

		const customMeta = {
			timestamp: commit.date,
			git_commit: commit.sha,
		};

		if (i === 0) {
			await initChain(chainPath, blockData, GENESIS_PREV_HASH, customMeta);
		} else {
			await appendBlock(chainPath, blockData, customMeta);
		}
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
		// Sort packages alphabetically
		const sortedPackages: Record<string, string> = {};
		for (const key of Object.keys(commit.packages).sort()) {
			sortedPackages[key] = commit.packages[key];
		}

		const payloadObj = {
			commit: commit.sha,
			author: commit.author,
			date: commit.date,
			message: commit.message,
			packages: sortedPackages,
		};
		const blockData = YAML.stringify(payloadObj);

		const customMeta = {
			timestamp: commit.date,
			git_commit: commit.sha,
		};

		await appendBlock(chainPath, blockData, customMeta);
	}

	// 6. Verify final modern chain and backup chain
	let postStatus = await getChainStatus(chainPath);
	let postVerification = await verifyChain(chainPath);
	let backupVerification = await verifyChain(rolloverResult.backupPath);

	if (!postVerification.valid || !backupVerification.valid) {
		throw new Error("❌ Final chain verification failed.");
	}

	// Modern chain should have: 1 genesis rollover block + 17 commits = 18 blocks
	const expectedBlocksCount = postRolloverFeed.length + 1;
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
