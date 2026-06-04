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

async function fetchCommits(): Promise<any[]> {
	let page = 1;
	let allCommits: any[] = [];
	while (true) {
		const url = `https://api.github.com/repos/oven-sh/bun/commits?path=package.json&per_page=100&page=${page}`;
		console.log(`Fetching page ${page} of commits for package.json...`);
		const res = await fetch(url, { headers });
		if (!res.ok) {
			throw new Error(`Failed to fetch commits list: ${res.status} - ${await res.text()}`);
		}
		const commits = (await res.json()) as any[];
		if (commits.length === 0) break;
		allCommits = allCommits.concat(commits);
		if (commits.length < 100) break;
		page++;
	}
	return allCommits;
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

// Fixed Concurrency helper
async function mapLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>
): Promise<R[]> {
	const results: Promise<R>[] = [];
	const executing: Promise<any>[] = [];
	
	for (const item of items) {
		const p = fn(item).then((res) => {
			const index = executing.indexOf(p);
			if (index !== -1) {
				executing.splice(index, 1);
			}
			return res;
		});
		executing.push(p);
		results.push(p);
		
		if (executing.length >= limit) {
			await Promise.race(executing);
		}
	}
	return Promise.all(results);
}

async function run() {
	try {
		console.log("1. Retrieving all commits that modified package.json...");
		const commits = await fetchCommits();
		console.log(`Found ${commits.length} commits.`);

		// Save the log of commit changes
		const commitLogStr = formatCommitLog(commits);
		const logPath = path.resolve(__dirname, "package-json-history.log");
		writeFileSync(logPath, commitLogStr, "utf8");
		console.log(`Saved commit log to: ${logPath}`);

		// Reversing commits to process chronologically (oldest first)
		const chronologicalCommits = [...commits].reverse();

		console.log("2. Downloading package.json content for each commit...");
		let downloadCount = 0;
		const compiledHistory: any[] = [];

		await mapLimit(chronologicalCommits, 15, async (c) => {
			const sha = c.sha;
			const date = c.commit.author.date;
			const url = `https://raw.githubusercontent.com/oven-sh/bun/${sha}/package.json`;
			
			try {
				const res = await fetch(url, { headers });
				if (res.ok) {
					const text = await res.text();
					let parsed: any = null;
					try {
						parsed = JSON.parse(text);
					} catch (e) {
						// ignore syntax errors in very old commits
					}
					
					if (parsed) {
						// Extract constraints
						const constraints: Record<string, string> = {};
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

						compiledHistory.push({
							sha: sha,
							author: `${c.commit.author.name} <${c.commit.author.email}>`,
							date: date,
							message: c.commit.message,
							constraints: constraints,
						});
					}
				}
			} catch (err: any) {
				console.error(`Error downloading at commit ${sha}: ${err.message}`);
			}
			
			downloadCount++;
			if (downloadCount % 50 === 0 || downloadCount === chronologicalCommits.length) {
				console.log(`Downloaded ${downloadCount}/${chronologicalCommits.length}...`);
			}
		});

		// Sort compiled history by date to guarantee chronological order
		compiledHistory.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

		const historyPath = path.resolve(__dirname, "package-json-history.json");
		writeFileSync(historyPath, JSON.stringify(compiledHistory, null, 2), "utf8");
		console.log(`Saved compiled package.json history JSON to: ${historyPath}`);
		console.log(`Completed successfully. Processed ${compiledHistory.length} successful history entries.`);

	} catch (err: any) {
		console.error("Execution failed:", err.message);
		process.exit(1);
	}
}

run();
