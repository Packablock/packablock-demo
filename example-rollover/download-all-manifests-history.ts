import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

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

const headers: Record<string, string> = {
	"User-Agent": "Packablock-Demo-Synthesizer",
	"Accept": "application/vnd.github.v3+json",
};
if (GITHUB_TOKEN) {
	headers.Authorization = `token ${GITHUB_TOKEN}`;
}

async function fetchCommitsForPath(filePath: string): Promise<any[]> {
	let page = 1;
	let allCommits: any[] = [];
	while (true) {
		const url = `https://api.github.com/repos/oven-sh/bun/commits?path=${encodeURIComponent(
			filePath,
		)}&per_page=100&page=${page}`;
		console.log(`Fetching page ${page} of commits for ${filePath}...`);
		const res = await fetch(url, { headers });
		if (!res.ok) {
			throw new Error(`Failed to fetch commits list for ${filePath}: ${res.status}`);
		}
		const commits = (await res.json()) as any[];
		if (commits.length === 0) break;
		allCommits = allCommits.concat(commits);
		if (commits.length < 100) break;
		page++;
	}
	return allCommits;
}

// Simple regex parsers for manifests content
function parseManifestConstraints(filename: string, content: string): Record<string, string> {
	const constraints: Record<string, string> = {};
	try {
		if (filename.endsWith(".json")) {
			const parsed = JSON.parse(content);
			const depKeys = ["dependencies", "devDependencies", "peerDependencies"];
			for (const key of depKeys) {
				if (parsed[key] && typeof parsed[key] === "object") {
					for (const [name, constraint] of Object.entries(parsed[key])) {
						if (typeof constraint === "string") {
							constraints[name] = constraint;
						}
					}
				}
			}
		} else if (filename.endsWith(".toml")) {
			// Extract standard TOML package dependency blocks
			const depBlocks = content.match(/\[(?:workspace\.)?dependencies\][^]*?(?=(?:\[|$))/g) || [];
			for (const block of depBlocks) {
				const lines = block.split("\n");
				for (const line of lines) {
					const m = line.match(/^\s*([a-zA-Z0-9_-]+)\s*=\s*(.*)/);
					if (m) {
						const name = m[1].trim();
						const val = m[2].trim().replace(/^"|"$/g, "");
						constraints[name] = val;
					}
				}
			}
		}
	} catch {
		// Ignore syntax errors in old commits
	}
	return constraints;
}

async function processFile(filePath: string, outputJsonName: string) {
	console.log(`\n--- Processing ${filePath} ---`);
	const commits = await fetchCommitsForPath(filePath);
	console.log(`Found ${commits.length} commits for ${filePath}.`);

	// Reverse to keep chronological order
	const chronologicalCommits = [...commits].reverse();
	const compiledHistory: any[] = [];

	// Limit to the most recent 100 commits to avoid rate limiting and speed up demo
	const targetCommits = chronologicalCommits.slice(-100);

	let count = 0;
	for (const c of targetCommits) {
		const sha = c.sha;
		const date = c.commit.author.date;
		const url = `https://raw.githubusercontent.com/oven-sh/bun/${sha}/${filePath}`;
		try {
			const res = await fetch(url, { headers });
			if (res.ok) {
				const text = await res.text();
				const constraints = parseManifestConstraints(path.basename(filePath), text);
				compiledHistory.push({
					sha,
					author: `${c.commit.author.name} <${c.commit.author.email}>`,
					date,
					message: c.commit.message,
					constraints,
				});
			}
		} catch (err: any) {
			console.error(`Error downloading ${filePath} at commit ${sha}: ${err.message}`);
		}
		count++;
		if (count % 20 === 0 || count === targetCommits.length) {
			console.log(`Downloaded ${count}/${targetCommits.length} for ${filePath}...`);
		}
	}

	compiledHistory.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
	const outPath = path.resolve(__dirname, outputJsonName);
	writeFileSync(outPath, JSON.stringify(compiledHistory, null, 2), "utf8");
	console.log(`Saved history to: ${outPath}`);
}

async function main() {
	try {
		await processFile("Cargo.toml", "cargo-toml-history.json");
		await processFile("bunfig.toml", "bunfig-toml-history.json");
		await processFile("tsconfig.json", "tsconfig-json-history.json");
		await processFile("packages/bun-types/package.json", "bun-types-history.json");
		await processFile("packages/@types/bun/package.json", "types-bun-history.json");
		console.log("\nAll manifest histories downloaded successfully!");
	} catch (err: any) {
		console.error("Failed to fetch histories:", err.message);
		process.exit(1);
	}
}

main();
