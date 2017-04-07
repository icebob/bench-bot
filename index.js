"use strict";

const express 		= require("express");
const path 			= require("path");
const http 			= require("http");
const bodyParser	= require("body-parser");
const mkdir			= require("mkdirp");
const chalk			= require("chalk");

const _				= require("lodash");
const Handlebars	= require("handlebars");
const GitHubApi		= require("github");
const exeq 			= require("exeq");
const del 			= require("del");


function fatal(msg) {
	console.error(chalk.red.bold("FATAL:", msg));
	process.exit(1);
}

const { REPO_OWNER, REPO_NAME, SUITE_FILENAME, GITHUB_TOKEN } = process.env;

if (!GITHUB_TOKEN)
	fatal("Missing github access token! Please generate a token on https://github.com/settings/tokens and set to the GITHUB_TOKEN environment variable!");

if (!REPO_OWNER)
	fatal("Missing repository owner! Please set REPO_OWNER environment variable!");

if (!REPO_NAME)
	fatal("Missing repository name! Please set REPO_NAME environment variable!");

if (!SUITE_FILENAME)
	fatal("Missing benchmarkify suite filename! Please set SUITE_FILENAME environment variable!");

const github = new GitHubApi({
	debug: false
});

github.authenticate({
	type: "token",
	token: GITHUB_TOKEN
});

// Create express app
const app = express();

app.set("showStackError", true);

app.use(bodyParser.urlencoded({
	extended: true
}));

app.use(bodyParser.json());	

app.post("/github-hook", (req, res) => {
	//console.log(req.headers);

	const event = req.headers["x-github-event"];
	if (event == "pull_request") {
		processPullRequest(req.body, req.headers);
	}

	res.sendStatus(200);
});

const port = process.env.PORT || 4278;
const ip = process.env.IP || "127.0.0.1";
app.listen(port, ip, function() {

	console.log("");
	console.log(chalk.green.bold("*** Web hook server is running on"));
	console.log(chalk.green.bold("*** "));
	console.log(chalk.white.bold(`*** http://${ip}:${port}/github-hook`));
	console.log(chalk.green.bold("*** "));
	console.log(chalk.green.bold("*** Set this URL in Webhooks in Github settings and enable the 'Pull request' events!"));
	console.log(chalk.green.bold(""));

});

function processPullRequest(payload) {
	console.log("New pull-request event received!\n");
	const prNumber = payload.number;

	if (["opened", "synchronize"].indexOf(payload.action) !== -1) {
		console.log(chalk.white.bold(`New PR opened! ID: ${prNumber}, Name: ${payload.pull_request.title}`));

		const headGitUrl = payload.pull_request.head.repo.clone_url; // Repo of PR
		const headGitBranch = payload.pull_request.head.ref; // Branch of PR
		const baseGitUrl = payload.pull_request.base.repo.clone_url; // Base repo
		const baseGitBranch = payload.pull_request.base.ref; // Base repo branch

		console.log("Base: ", chalk.white.bold(baseGitUrl), "  Branch: ", chalk.magenta.bold(baseGitBranch));
		console.log("  PR: ", chalk.white.bold(headGitUrl), "  Branch: ", chalk.magenta.bold(headGitBranch));

		let workID = Math.random().toString(36).replace(/[^a-z]+/g, "");
		console.log("Temp folder: " + workID + "\n");

		let folder = "./tmp/" + workID;
		mkdir.sync(folder);

		let masterFolder = path.join(folder, "master");
		mkdir.sync(masterFolder);

		let prFolder = path.join(folder, "pr");
		mkdir.sync(prFolder);

		return runBenchmark(baseGitUrl, baseGitBranch, masterFolder).then(masterResult => {
			return runBenchmark(headGitUrl, headGitBranch, prFolder).then(prResult => {
				return compareResults(masterResult, prResult);
			});
		})
		.then(compared => {
			// console.log("Compare result:", compared);

			// Create comment on PR
			return addResultCommentToPR(prNumber, compared);
		})
		.then(() => {
			console.log(chalk.green.bold("Done!"));
		})
		.catch(err => console.error(err))
		.then(() => {
			// Delete tmp folder
			return del([folder]);
		});
	}

	return Promise.resolve();
}

function runBenchmark(gitUrl, branch, folder) {
	return Promise.resolve().then(() => {
		return exeq("git clone " + gitUrl + " " + folder, "cd " + folder, "git checkout " + branch, "npm i --quiet").then(msgs => {
			return require(path.join(__dirname, folder, SUITE_FILENAME));
		});
	});
}

function formatNum(num, decimals = 0, addSign = false) {
	let res = Number(num.toFixed(decimals)).toLocaleString();
	if (addSign && num > 0.0)
		res = "+" + res;
	return res;
}

function compareResults(masterResult, prResult) {
	let comparedResult = {
		name: masterResult.name,
		suites: [],
		masterJSON: JSON.stringify(masterResult, null, 2),
		prJSON: JSON.stringify(prResult, null, 2)
	};

	const suiteNames = _.uniq([].concat(masterResult.suites, prResult.suites).map(suite => suite.name));

	suiteNames.forEach(suiteName => {
		const mSuite = masterResult.suites.find(item => item.name == suiteName);
		const pSuite = prResult.suites.find(item => item.name == suiteName);

		let suiteRes = {
			name: suiteName,
			tests: []
		};

		const testNames = _.uniq([].concat(mSuite ? mSuite.tests : [], pSuite ? pSuite.tests : []).map(test => test.name));

		testNames.forEach(testName => {
			const mTest = mSuite && mSuite.tests.find(item => item.name == testName);
			const pTest = mSuite && pSuite.tests.find(item => item.name == testName);

			const masterRps = mTest && mTest.stat ? mTest.stat.rps : null;
			const prRps = pTest && mTest.stat ? pTest.stat.rps : null;

			let testCompare = {
				name: testName,
				skipped: mTest.skipped && pTest.skipped,
				//masterResult: mTest,
				//prResult: pTest,
				masterRps: masterRps ? formatNum(masterRps) : "[SKIP]", 
				prRps: prRps ? formatNum(prRps) : "[SKIP]"
			};

			if (masterRps && prRps) {
				const percent = ((prRps - masterRps) * 100.0) / masterRps;
				const percentage = formatNum(percent, 0, true);

				testCompare.diff = formatNum(prRps - masterRps, 0, true);
				testCompare.percentage = percentage;
				testCompare.badge = `https://img.shields.io/badge/performance-${percentage.replace("-", "--")}%25-${getBadgeColor(percent)}.svg`;
			} else {
				testCompare.diff = "-";
				testCompare.percentage = "skipped";
				testCompare.badge = "https://img.shields.io/badge/performance-skipped-lightgrey.svg";
			}

			suiteRes.tests.push(testCompare);
		});

		comparedResult.suites.push(suiteRes);
	});

	return Promise.resolve(comparedResult);
}

function getBadgeColor(value) {
	if (value > 20) return "brightgreen";
	if (value > 5) return "green";
	if (value < 5) return "orange";
	if (value < 20) return "red";

	return "yellow";
}

const commentTemplate = Handlebars.compile(`
# Benchmark results

## {{name}}

{{#each suites}}
### Suite: {{name}}

| Test | Master (runs/sec) | PR (runs/sec) | Diff (runs/sec) |
| ------- | ----- | ------- | ------- |
{{#each tests}}
|**{{name}}**| \`{{masterRps}}\` | \`{{prRps}}\` | ![Performance: {{percentage}}%]({{badge}}) \`{{diff}}\` |
{{/each}}

{{/each}}

{{#if masterJSON}}
<details>
  <summary>Master detailed results</summary>
  <pre>
{{masterJSON}}
  </pre>
</details>
{{/if}}

{{#if prJSON}}
<details>
  <summary>PR detailed results</summary>
  <pre>
{{prJSON}}
  </pre>
</details>
{{/if}}
`);

function addResultCommentToPR(number, result) {
	return github.issues.createComment({
		owner: REPO_OWNER,
		repo: REPO_NAME,
		number,
		body: commentTemplate(result)
	}).then(() => {
		console.info(chalk.yellow.bold(`Result posted successfully to https://github.com/${REPO_OWNER}/${REPO_NAME}/pull/${number}`));
	});
}
