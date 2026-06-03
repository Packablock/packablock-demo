import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
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

let GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
if (!GITHUB_TOKEN) {
	const envPath = path.resolve(__dirname, "../../.env.agy");
	if (existsSync(envPath)) {
		const envContent = readFileSync(envPath, "utf8");
		const match = envContent.match(/GITHUB_TOKEN\s*=\s*(.+)/);
		if (match?.[1]) {
			GITHUB_TOKEN = match[1].trim().replace(/^['"]|['"]$/g, "");
		}
	}
}
const TOKEN = GITHUB_TOKEN;

function parseYarnLock(text: string): Record<string, string> {
	const packages: Record<string, string> = {};
	const lines = text.split("\n");
	let currentPackageName: string | null = null;

	for (let line of lines) {
		line = line.trim();
		if (!line || line.startsWith("#")) continue;

		if (line.endsWith(":")) {
			const parts = line.slice(0, -1).split(",");
			const firstPart = (parts[0] ?? "").trim();
			let name = "";
			if (firstPart.startsWith('"')) {
				const unquoted = firstPart.replace(/^"|"$/g, "");
				name = getPackageNameFromRef(unquoted);
			} else {
				name = getPackageNameFromRef(firstPart);
			}
			if (name) {
				currentPackageName = name;
			}
		} else if (
			currentPackageName &&
			(line.startsWith("version ") || line.startsWith("version:"))
		) {
			const verMatch = line.match(/version\s+["']?([^"']+)["']?/);
			if (verMatch?.[1]) {
				packages[currentPackageName] = verMatch[1];
				currentPackageName = null;
			}
		}
	}
	return packages;
}

function getPackageNameFromRef(ref: string): string {
	if (ref.startsWith("@")) {
		const parts = ref.slice(1).split("@");
		return `@${parts[0] ?? ""}`;
	}
	return ref.split("@")[0] ?? "";
}

async function run() {
	const logContent = readFileSync(
		path.resolve(__dirname, "bun-lock-pre-rollover.log"),
		"utf8",
	);
	const commits: {
		sha: string;
		author: string;
		date: string;
		message: string;
	}[] = [];

	// Parse commits from log
	const blocks = logContent.split(
		"--------------------------------------------------------------------------------",
	);
	for (const block of blocks) {
		const lines = block.trim().split("\n");
		if (lines.length < 4) continue;

		const shaMatch = lines[0].match(/commit (\w+)/);
		const authorMatch = lines[1].match(/Author: (.+)/);
		const dateMatch = lines[2].match(/Date:   (.+)/);

		if (shaMatch && authorMatch && dateMatch) {
			commits.push({
				sha: shaMatch[1],
				author: authorMatch[1],
				date: dateMatch[1],
				message: lines.slice(4).join("\n").trim(),
			});
		}
	}

	// Reverse to process chronologically (oldest to newest)
	commits.reverse();

	console.log(
		`Analyzing package evolution across ${commits.length} ancient commits...`,
	);

	let prevPkgs: Record<string, string> = {};
	let outContent = "";

	// Standard out logging function
	const log = (msg: string) => {
		console.log(msg);
		outContent += `${msg.replace(/\x1b\[[0-9;]*m/g, "")}\n`; // strip ANSI colors for log file
	};

	log(
		"================================================================================",
	);
	log("📦 ANCIENT BUN.LOCKB DEPENDENCY EVOLUTION LOG");
	log(
		"================================================================================" +
			"\n",
	);

	const tempLockbPath = "/tmp/bun.lockb";

	for (let i = 0; i < commits.length; i++) {
		const c = commits[i];
		// Fetch lockb at this commit
		const url = `https://raw.githubusercontent.com/oven-sh/bun/${c.sha}/bun.lockb`;
		let text = "";
		try {
			const res = await fetch(url, {
				headers: { Authorization: `Bearer ${TOKEN}` },
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const buf = await res.arrayBuffer();
			writeFileSync(tempLockbPath, Buffer.from(buf));

			// Decode bun.lockb to yarn format
			text = execSync(`bun ${tempLockbPath}`, {
				encoding: "utf8",
				stdio: ["pipe", "pipe", "ignore"],
			});
		} catch (err: any) {
			// Some early commits might not have bun.lockb
			continue;
		}

		const currentPkgs = parseYarnLock(text);

		const added: string[] = [];
		const removed: string[] = [];
		const changed: string[] = [];

		for (const [name, toVer] of Object.entries(currentPkgs)) {
			const fromVer = prevPkgs[name];
			if (fromVer === undefined) {
				added.push(`${name}@${toVer}`);
			} else if (fromVer !== toVer) {
				changed.push(`${name}: ${fromVer} ➔ ${toVer}`);
			}
		}

		for (const [name, fromVer] of Object.entries(prevPkgs)) {
			if (currentPkgs[name] === undefined) {
				removed.push(`${name}@${fromVer}`);
			}
		}

		if (
			added.length > 0 ||
			removed.length > 0 ||
			changed.length > 0 ||
			i === 0
		) {
			log(`${colors.bold}${colors.yellow}commit ${c.sha}${colors.reset}`);
			log(`Author: ${c.author}`);
			log(`Date:   ${c.date}`);
			log(`Msg:    ${c.message.split("\n")[0]}`);

			if (i === 0) {
				log(
					`  ${colors.green}+ Initial Baseline (${Object.keys(currentPkgs).length} packages)${colors.reset}`,
				);
			} else {
				if (added.length > 0) {
					log(`  ${colors.green}+ Added (${added.length}):${colors.reset}`);
					added.forEach((p) => log(`    • ${p}`));
				}
				if (removed.length > 0) {
					log(`  ${colors.red}- Removed (${removed.length}):${colors.reset}`);
					removed.forEach((p) => log(`    • ${p}`));
				}
				if (changed.length > 0) {
					log(`  ${colors.cyan}Δ Changed (${changed.length}):${colors.reset}`);
					changed.forEach((p) => log(`    • ${p}`));
				}
			}
			log(
				"--------------------------------------------------------------------------------",
			);
		}

		prevPkgs = currentPkgs;
	}

	const outPath = path.resolve(__dirname, "bun-lock-pre-rollover-diffs.log");
	writeFileSync(outPath, outContent, "utf8");
	console.log(`Saved pre-rollover diff history to: ${outPath}`);
}

run().catch(console.error);
