import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const TOKEN = process.env.GITHUB_TOKEN || "";
const tempLockbPath = "/tmp/bun.lockb";

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

function parseBunLockPackages(content: string): Record<string, string> {
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

function getPackageNameFromRef(ref: string): string {
	if (ref.startsWith("@")) {
		const parts = ref.slice(1).split("@");
		return `@${parts[0] ?? ""}`;
	}
	return ref.split("@")[0] ?? "";
}

async function compilePreRollover() {
	const logContent = readFileSync(path.resolve(__dirname, "bun-lock-pre-rollover.log"), "utf8");
	const commits: any[] = [];
	const blocks = logContent.split("--------------------------------------------------------------------------------");
	
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
				message: lines.slice(4).join("\n").trim()
			});
		}
	}

	commits.reverse();
	console.log(`Processing ${commits.length} pre-rollover commits...`);

	const result: any[] = [];
	let prevPkgs: any = {};

	for (const c of commits) {
		const url = `https://raw.githubusercontent.com/oven-sh/bun/${c.sha}/bun.lockb`;
		try {
			const res = await fetch(url, { headers: TOKEN ? { "Authorization": `Bearer ${TOKEN}` } : {} });
			if (!res.ok) continue;
			const buf = await res.arrayBuffer();
			writeFileSync(tempLockbPath, Buffer.from(buf));
			const text = execSync(`bun ${tempLockbPath}`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
			const pkgs = parseYarnLock(text);

			// Check if diff exists
			const isDiff = JSON.stringify(pkgs) !== JSON.stringify(prevPkgs);
			if (isDiff || result.length === 0) {
				result.push({ ...c, packages: pkgs });
				prevPkgs = pkgs;
			}
		} catch {}
	}

	const outPath = path.resolve(__dirname, "bun-pre-rollover-packages.json");
	writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
	console.log(`Compiled pre-rollover package history with ${result.length} blocks to ${outPath}`);
}

async function compilePostRollover() {
	const logContent = readFileSync(path.resolve(__dirname, "bun-lock-post-rollover.log"), "utf8");
	const commits: any[] = [];
	const blocks = logContent.split("--------------------------------------------------------------------------------");
	
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
				message: lines.slice(4).join("\n").trim()
			});
		}
	}

	commits.reverse();
	console.log(`Processing ${commits.length} post-rollover commits...`);

	const result: any[] = [];
	let prevPkgs: any = {};

	for (const c of commits) {
		const url = `https://raw.githubusercontent.com/oven-sh/bun/${c.sha}/bun.lock`;
		try {
			const res = await fetch(url, { headers: TOKEN ? { "Authorization": `Bearer ${TOKEN}` } : {} });
			if (!res.ok) continue;
			const content = await res.text();
			const pkgs = parseBunLockPackages(content);

			// Check if diff exists
			const isDiff = JSON.stringify(pkgs) !== JSON.stringify(prevPkgs);
			if (isDiff || result.length === 0) {
				result.push({ ...c, packages: pkgs });
				prevPkgs = pkgs;
			}
		} catch {}
	}

	const outPath = path.resolve(__dirname, "bun-post-rollover-packages.json");
	writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
	console.log(`Compiled post-rollover package history with ${result.length} blocks to ${outPath}`);
}

async function main() {
	await compilePreRollover();
	await compilePostRollover();
}

main().catch(console.error);
