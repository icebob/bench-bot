"use strict";

const express 		= require("express");
const path 			= require("path");
const http 			= require("http");
const bodyParser	= require("body-parser");
const mkdir			= require("mkdirp");

const _				= require("lodash");
const Handlebars	= require("handlebars");
const GitHubApi		= require("github");
const exeq 			= require("exeq");
const del 			= require("del");

const { REPO_OWNER, REPO_NAME, SUITE_FILENAME } = process.env;

const github = new GitHubApi({
	debug: false
});

github.authenticate({
	type: "token",
	token: process.env.GITHUB_TOKEN
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
	else if (event == "push") {
		processPush(req.body, req.headers);
	}

	res.sendStatus(200);
});

const port = 4278;
app.listen(port, function() {
	console.log("Developer server running on http://localhost:" + port);
});

function processPullRequest(payload) {
	console.log("PR event!");
	const prNumber = payload.number;
	if (["opened", "synchronize"].indexOf(payload.action) !== -1) {
		console.log(`New PR opened! ID: ${prNumber}, Name: ${payload.pull_request.title}`);

		const headGitUrl = payload.pull_request.head.repo.clone_url; // PR repo-ja
		const headGitBranch = payload.pull_request.head.ref; // PR branch-e
		const baseGitUrl = payload.pull_request.base.repo.clone_url; // Alap master repo
		const baseGitBranch = payload.pull_request.base.ref; // Alap repo branch-e

		console.log("Master: ", baseGitUrl, ", Branch: ", baseGitBranch);
		console.log("PR: ", headGitUrl, ", Branch: ", headGitBranch);

		let workID = Math.random().toString(36).replace(/[^a-z]+/g, '');
		console.log("Work ID: " + workID);

		let folder = "./tmp/" + workID;
		mkdir.sync(folder);

		let masterFolder = path.join(folder, "master");
		mkdir.sync(masterFolder);

		let prFolder = path.join(folder, "pr");
		mkdir.sync(prFolder);

		runBenchmark(baseGitUrl, baseGitBranch, masterFolder).then(masterResult => {
			return runBenchmark(headGitUrl, headGitBranch, prFolder).then(prResult => {
				return compareResults(masterResult, prResult);
			});
		})
		.then(compared => {
			// console.log("Compare result:", compared);

			// Create comment on PR
			addCommentToPR(prNumber, compared);
		})
		.then(() => {
			// Delete tmp folder
			return del([folder]);
		})
		.then(() => {
			console.log("Done!");
		})
		.catch(err => console.error(err));
	}
}

function processPush(payload) {
	console.log("Push event!");
}

function runBenchmark(gitUrl, branch, folder) {
	return Promise.resolve()
		.then(() => {
			return exeq("git clone " + gitUrl + " " + folder, "cd " + folder, "git checkout " + branch, "npm i --quiet")
				.then(msgs => {
					return require(path.join(__dirname, folder, SUITE_FILENAME));
				})
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
				const percentage = formatNum(percent, 0, true)

				testCompare.diff = formatNum(prRps - masterRps, 0, true);
				testCompare.percentage = percentage;
				testCompare.badge = `https://img.shields.io/badge/performance-${percentage.replace('-', '--')}%25-${getBadgeColor(percent)}.svg`
			} else {
				testCompare.diff = "-";
				testCompare.percentage = "";
				testCompare.badge = `https://img.shields.io/badge/performance-skipped-lightgrey.svg`
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

function addCommentToPR(number, result) {
	return github.issues.createComment({
		owner: REPO_OWNER,
		repo: REPO_NAME,
		number,
		body: commentTemplate(result)
	});
}
/*

compareResults(
{
  "name": "Simple example",
  "suites": [
    {
      "name": "String concatenate",
      "tests": [
        {
          "name": "Concat with '+'",
          "fastest": true,
          "stat": {
            "duration": 5.007086467,
            "cycle": 153,
            "count": 153000,
            "avg": 0.00003272605533986928,
            "rps": 30556.692201816535,
            "percent": 81.51821774001732
          }
        },
        {
          "name": "Concat with array & join",
          "reference": true,
          "stat": {
            "duration": 5.051803217,
            "cycle": 90,
			"count": 90000,
            "avg": 0.00005613114685555555,
            "rps": 17387.420778295134,
            "percent": 0
          }
        }
      ]
    },
    {
      "name": "Increment integer",
      "tests": [
        {
          "name": "Increment with ++",
          "fastest": true,
          "stat": {
            "duration": 4.999928158,
            "cycle": 333918,
            "count": 333918000,
            "avg": 1.4973520918309286e-8,
            "rps": 66784559.58726597,
            "percent": 0
          }
        },
        {
          "name": "Increment with +=",
          "skipped": true
        },
        {
          "name": "Increment with = i + 1",
          "stat": {
            "duration": 4.998890598,
            "cycle": 325496,
            "count": 325496000,
            "avg": 1.5357763530120187e-8,
            "rps": 65113647.44213992,
            "percent": -2.501943795770188
          }
        }
      ]
    }
  ],
  "timestamp": 1491573679617,
  "generated": "Fri Apr 07 2017 16:01:19 GMT+0200 (Közép-európai nyári idő )",
  "elapsedMs": 20902
},{
  "name": "Simple example",
  "suites": [
    {
      "name": "String concatenate",
      "tests": [
        {
          "name": "Concat with '+'",
          "fastest": true,
          "stat": {
            "duration": 5.007086467,
            "cycle": 153,
            "count": 153000,
            "avg": 0.00003272605533986928,
            "rps": 30556.692201816535,
            "percent": 71.51821774001732
          }
        },
        {
          "name": "Concat with array & join",
          "reference": true,
          "stat": {
            "duration": 5.051803217,
            "cycle": 90,
			"count": 90000,
            "avg": 0.00005613114685555555,
            "rps": 17815.420778295134,
            "percent": 0
          }
        }
      ]
    },
    {
      "name": "Increment integer",
      "tests": [
        {
          "name": "Increment with ++",
          "fastest": true,
          "stat": {
            "duration": 4.999928158,
            "cycle": 333918,
            "count": 333918000,
            "avg": 1.4973520918309286e-8,
            "rps": 66784559.58726597,
            "percent": 0
          }
        },
        {
          "name": "Increment with +=",
          "skipped": true
        },
        {
          "name": "Increment with = i + 1",
          "stat": {
            "duration": 4.998890598,
            "cycle": 325496,
            "count": 325496000,
            "avg": 1.5357763530120187e-8,
            "rps": 65113647.44213992,
            "percent": -2.501943795770188
          }
        }
      ]
    }
  ],
  "timestamp": 1491573679617,
  "generated": "Fri Apr 07 2017 16:01:19 GMT+0200 (Közép-európai nyári idő )",
  "elapsedMs": 20902
}).then(res => {
	console.log("Res:",JSON.stringify(res, null, 2));
});*/