import { execSync } from "node:child_process";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { initChain, appendBlock, GENESIS_PREV_HASH } from "../../packablock-client/src/chain";
import { parseSingleLockfileContent, locatePackageInFile, readPackageJsonConstraints } from "../../packablock-client/src/lockfile";
import { getPackageDiff } from "../../packablock-client/src/diff";
import YAML from "yaml";

interface CommitPatch {
	sha: string;
	authorName: string;
	authorEmail: string;
	date: string;
	message: string;
	patch: string;
	filename: string;
}

function parseGitLogPatch(content: string, filename: string): CommitPatch[] {
	const commits: CommitPatch[] = [];
	const rawCommits = content.split(/\n(?=commit [0-9a-f]{40})/);

	for (const raw of rawCommits) {
		const lines = raw.split("\n");
		const firstLine = lines[0];
		if (!firstLine || !firstLine.startsWith("commit ")) continue;

		const sha = firstLine.slice(7).trim();
		let authorName = "Test Bot";
		let authorEmail = "bot@test.com";
		let date = "";
		const messageLines: string[] = [];
		const patchLines: string[] = [];
		let inPatch = false;

		for (let i = 1; i < lines.length; i++) {
			const line = lines[i];
			if (line === undefined) continue;

			if (inPatch) {
				patchLines.push(line);
			} else if (line.startsWith("Author: ")) {
				const match = line.slice(8).match(/^(.*?) <(.*?)>$/);
				if (match && match[1] && match[2]) {
					authorName = match[1];
					authorEmail = match[2];
				}
			} else if (line.startsWith("Date: ")) {
				date = line.slice(5).trim();
			} else if (line.startsWith("diff --git ")) {
				inPatch = true;
				patchLines.push(line);
			} else {
				if (line.startsWith("    ")) {
					messageLines.push(line.slice(4));
				}
			}
		}

		commits.push({
			sha,
			authorName,
			authorEmail,
			date,
			message: messageLines.join("\n").trim(),
			patch: patchLines.join("\n"),
			filename,
		});
	}

	return commits;
}

async function main() {
	const token = process.argv[2];
	if (!token) {
		console.error("Usage: bun setup-bun-chain.ts <token> [registryUrl]");
		process.exit(1);
	}

	const registryUrl = process.argv[3] || "http://localhost:3030";

	const tempDir = path.resolve(__dirname, "./temp-bun-e2e-git");
	rmSync(tempDir, { recursive: true, force: true });
	mkdirSync(tempDir, { recursive: true });

	// Initialize git repo
	execSync("git init", { cwd: tempDir });
	execSync("git config user.name 'Test Bot'", { cwd: tempDir });
	execSync("git config user.email 'bot@test.com'", { cwd: tempDir });

	const logFiles = [
		"package.json.log",
		"bun.lock.log",
		"bun.lockb.log",
		"Cargo.toml.log",
		"Cargo.lock.log",
	];

	// Parse commits from all files
	const allCommits: CommitPatch[] = [];
	for (const file of logFiles) {
		const filename = file.replace(".log", "");
		console.log(`Parsing history from ${file}...`);
		const logPath = path.resolve(__dirname, `./fixtures/${file}`);
		const content = await fs.readFile(logPath, "utf8");
		const commits = parseGitLogPatch(content, filename);
		allCommits.push(...commits);
	}

	// Sort chronologically by date
	allCommits.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
	console.log(`Merged and sorted ${allCommits.length} commits chronologically.`);

	const cliPath = path.resolve(__dirname, "../../packablock-client/index.ts");
	const chainPath = path.join(tempDir, "packablock.yaml");
	const trackedLockfiles = new Set<string>();
	const lastPackagesMap = new Map<string, Record<string, string>>();
	const lastPackagesStrMap = new Map<string, string>();
	let blockCount = 0;

	// Replay chronologically
	for (const commit of allCommits) {
		const filename = commit.filename;
		const filePath = path.join(tempDir, filename);

		// Apply patch
		const patchPath = path.join(tempDir, "temp.patch");
		writeFileSync(patchPath, commit.patch, "utf8");

		try {
			execSync("git apply --binary temp.patch", { cwd: tempDir, stdio: "ignore" });
		} catch (err) {
			// Some patches might apply empty
		}

		try {
			rmSync(patchPath);
		} catch (e) {}

		// Commit to Git to simulate the real commit environment
		execSync("git add .", { cwd: tempDir });
		execSync("git commit -F -", {
			cwd: tempDir,
			input: commit.message,
			env: {
				...process.env,
				GIT_AUTHOR_NAME: commit.authorName,
				GIT_AUTHOR_EMAIL: commit.authorEmail,
				GIT_AUTHOR_DATE: commit.date,
				GIT_COMMITTER_NAME: commit.authorName,
				GIT_COMMITTER_EMAIL: commit.authorEmail,
				GIT_COMMITTER_DATE: commit.date,
			},
		});

		// Check status on disk
		const fileExists = existsSync(filePath);

		if (!fileExists) {
			// File was deleted
			if (trackedLockfiles.has(filename)) {
				console.log(`File ${filename} was deleted in commit ${commit.sha.slice(0, 7)}. Recording forget block.`);
				const payloadObj = {
					lockfiles: {
						[filename]: {
							chain_event: "forget",
						},
					},
				};
				const blockData = YAML.stringify(payloadObj);
				await appendBlock(chainPath, blockData, { timestamp: commit.date });
				trackedLockfiles.delete(filename);
				blockCount++;
			}
		} else {
			// File exists, parse content
			const content = await fs.readFile(filePath, "utf8");
			let parsedPackages: Record<string, string> = {};
			try {
				parsedPackages = parseSingleLockfileContent(filename, content);
			} catch (err: any) {
				console.log(`⚠️ Skipping parser error for ${filename} at commit ${commit.sha}: ${err.message}`);
				continue;
			}

			const packagesYaml = YAML.stringify(parsedPackages).trim();
			const lastPackagesStr = lastPackagesStrMap.get(filename) || "";

			if (packagesYaml !== lastPackagesStr) {
				const constraints = readPackageJsonConstraints(filePath);

				if (!trackedLockfiles.has(filename)) {
					console.log(`Tracking ${filename} for the first time at commit ${commit.sha.slice(0, 7)}`);
					const payloadObj: any = {
						lockfiles: {
							[filename]: {
								packages: Object.entries(parsedPackages).map(([name, ver]) => ({
									[name]: ver,
								})),
							},
						},
					};

					if (blockCount > 0) {
						payloadObj.lockfiles[filename].chain_event = "init";
					}
					if (constraints) {
						payloadObj["package.json"] = { constraints };
					}

					const blockData = YAML.stringify(payloadObj);
					if (blockCount === 0) {
						await initChain(chainPath, blockData, undefined, { timestamp: commit.date });
					} else {
						await appendBlock(chainPath, blockData, { timestamp: commit.date });
					}
					trackedLockfiles.add(filename);
					blockCount++;
				} else {
					// Subsequent update
					const locations: Record<string, { line: number; column: number }> = {};
					for (const name of Object.keys(parsedPackages)) {
						locations[name] = locatePackageInFile(content, name);
					}
					const lastPackages = lastPackagesMap.get(filename) || {};
					const diff = getPackageDiff(lastPackages, parsedPackages, locations);

					const payloadObj: any = {
						lockfiles: {
							[filename]: {
								packages: diff,
							},
						},
					};
					if (constraints) {
						payloadObj["package.json"] = { constraints };
					}

					const blockData = YAML.stringify(payloadObj);
					await appendBlock(chainPath, blockData, { timestamp: commit.date });
					blockCount++;
				}

				lastPackagesMap.set(filename, parsedPackages);
				lastPackagesStrMap.set(filename, packagesYaml);
			}
		}
	}

	console.log(`Git history replayed and ${blockCount} blocks written to chain successfully!`);

	console.log("Pushing chain to registry...");
	execSync(`bun run ${cliPath} push packablock.yaml -s ${registryUrl} -t ${token}`, { cwd: tempDir });

	console.log("Chain pushed successfully!");

	// Clean up
	rmSync(tempDir, { recursive: true, force: true });
}

main().catch(err => {
	console.error("Failed to set up bun chain:", err);
	process.exit(1);
});
