import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const colors = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
	gray: "\x1b[90m",
};

// Helper to parse Bun 1.2+ JSON lockfile packages
function parseBunLockPackages(filepath: string): Record<string, string> {
	const content = readFileSync(filepath, "utf8");
	const cleanContent = content.replace(/,(\s*[\]}])/g, "$1");
	const data = JSON.parse(cleanContent);
	const packages: Record<string, string> = {};

	if (data.packages) {
		for (const [pkgPath, pkgInfo] of Object.entries<any>(data.packages)) {
			if (!pkgPath) continue;
			const name = pkgPath.replace(/^node_modules\//, "");

			if (Array.isArray(pkgInfo)) {
				const sig = pkgInfo[0];
				if (typeof sig === "string") {
					if (sig.startsWith(name + "@")) {
						packages[name] = sig.slice(name.length + 1);
					} else {
						const lastAt = sig.lastIndexOf("@");
						if (lastAt !== -1) {
							packages[name] = sig.slice(lastAt + 1);
						}
					}
				}
			} else if (pkgInfo && typeof pkgInfo === "object" && pkgInfo.version) {
				packages[name] = pkgInfo.version;
			}
		}
	}
	return packages;
}

const currentLockPath = path.resolve(__dirname, "bun.lock");
const currentPkgs = parseBunLockPackages(currentLockPath);

console.log(
	`${colors.bold}${colors.cyan}Comparing historical snapshots against current bun.lock (${Object.keys(currentPkgs).length} packages)${colors.reset}\n`,
);

const files = readdirSync(__dirname)
	.filter((f) => f.startsWith("bun-20") && f.endsWith(".lock"))
	.sort();

for (const file of files) {
	const filePath = path.resolve(__dirname, file);
	const snapshotPkgs = parseBunLockPackages(filePath);

	console.log(
		`${colors.bold}${colors.yellow}📄 ${file} (${Object.keys(snapshotPkgs).length} packages)${colors.reset}`,
	);

	const added: { name: string; ver: string }[] = [];
	const removed: { name: string; ver: string }[] = [];
	const changed: { name: string; from: string; to: string }[] = [];

	// Find added & changed
	for (const [name, toVer] of Object.entries(currentPkgs)) {
		const fromVer = snapshotPkgs[name];
		if (fromVer === undefined) {
			added.push({ name, ver: toVer });
		} else if (fromVer !== toVer) {
			changed.push({ name, from: fromVer, to: toVer });
		}
	}

	// Find removed
	for (const [name, fromVer] of Object.entries(snapshotPkgs)) {
		if (currentPkgs[name] === undefined) {
			removed.push({ name, ver: fromVer });
		}
	}

	if (added.length === 0 && removed.length === 0 && changed.length === 0) {
		console.log(`  ${colors.gray}No changes detected.${colors.reset}`);
	} else {
		if (added.length > 0) {
			console.log(`  ${colors.green}+ Added (${added.length}):${colors.reset}`);
			for (const p of added.slice(0, 5)) {
				console.log(`    ${p.name}: ${p.ver}`);
			}
			if (added.length > 5) {
				console.log(`    ... and ${added.length - 5} more`);
			}
		}
		if (removed.length > 0) {
			console.log(`  ${colors.red}- Removed (${removed.length}):${colors.reset}`);
			for (const p of removed.slice(0, 5)) {
				console.log(`    ${p.name}: ${p.ver}`);
			}
			if (removed.length > 5) {
				console.log(`    ... and ${removed.length - 5} more`);
			}
		}
		if (changed.length > 0) {
			console.log(`  ${colors.cyan}Δ Changed/Upgraded (${changed.length}):${colors.reset}`);
			for (const p of changed.slice(0, 5)) {
				console.log(`    ${p.name}: ${p.from} ➔ ${p.to}`);
			}
			if (changed.length > 5) {
				console.log(`    ... and ${changed.length - 5} more`);
			}
		}
	}
	console.log("");
}
