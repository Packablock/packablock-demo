import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

let GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
if (!GITHUB_TOKEN) {
	// Try loading from .env.agy
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

async function fetchCommits(filePath: string): Promise<any[]> {
	const url = `https://api.github.com/repos/oven-sh/bun/commits?path=${encodeURIComponent(filePath)}&per_page=100`;
	console.log(`Fetching commit logs for: ${filePath}`);
	const res = await fetch(url, { headers });
	if (!res.ok) {
		throw new Error(`Failed to fetch commits for ${filePath}: ${res.status} - ${await res.text()}`);
	}
	return (await res.json()) as any[];
}

function formatCommitLog(commits: any[]): string {
	let output = "";
	for (const c of commits) {
		const sha = c.sha;
		const author = `${c.commit.author.name} <${c.commit.author.email}>`;
		const date = c.commit.author.date;
		const message = c.commit.message;

		output += `commit ${sha}\n`;
		output += `Author: ${author}\n`;
		output += `Date:   ${date}\n\n`;
		output += `    ${message.split("\n").join("\n    ")}\n\n`;
		output += `--------------------------------------------------------------------------------\n`;
	}
	return output;
}

async function run() {
	try {
		// 1. Download latest package.json from oven-sh/bun
		console.log("Downloading latest package.json from oven-sh/bun...");
		const pkgRes = await fetch("https://raw.githubusercontent.com/oven-sh/bun/main/package.json");
		if (!pkgRes.ok) throw new Error(`HTTP ${pkgRes.status} fetching package.json`);
		const pkgContent = await pkgRes.text();
		writeFileSync(path.resolve(__dirname, "package.json"), pkgContent, "utf8");
		console.log("Latest package.json saved successfully.");

		// 2. Fetch commits for bun.lockb (pre-rollover)
		const preCommits = await fetchCommits("bun.lockb");
		const preLog = formatCommitLog(preCommits);
		writeFileSync(path.resolve(__dirname, "bun-lock-pre-rollover.log"), preLog, "utf8");
		console.log(`Saved pre-rollover commits list (${preCommits.length} commits).`);

		// 3. Fetch commits for bun.lock (post-rollover)
		const postCommits = await fetchCommits("bun.lock");
		const postLog = formatCommitLog(postCommits);
		writeFileSync(path.resolve(__dirname, "bun-lock-post-rollover.log"), postLog, "utf8");
		console.log(`Saved post-rollover commits list (${postCommits.length} commits).`);

		console.log("All logs and package.json updated successfully.");
	} catch (err: any) {
		console.error("Failed to download logs:", err.message);
		process.exit(1);
	}
}

run();
