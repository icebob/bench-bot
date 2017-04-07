# :construction_worker: bench-bot
Benchmark runner robot for [Benchmarkify](https://github.com/icebob/benchmarkify)

# Installation

```
$ git clone https://github.com/icebob/bench-bot.git
```

## Environment variables
* `PORT` - exposed port for server
* `REPO_OWNER` - owner's username of repository (e.g: icebob)
* `REPO_NAME` - Repository name (e.g: bench-bot)
* `SUITE_FILENAME` - [Benchmarkify](https://github.com/icebob/benchmarkify) suite filename with path (e.g: `benchmark/suites/perf.js`)
* `GITHUB_TOKEN` - Token to access github. You can create one in [Github settings](https://github.com/settings/tokens)

# Usage

## Local
First set environment variables.
```
$ npm start
```
## Docker
Rename the `dc.env.sample` to `dc.env` and set environment variables.
```
$ docker-compose build
$ docker-compose up -d
```

If the bot is running you should set a Web hook for your repository.
The payload URL: 

`http://<server-address>:4278/github-hook`

![image](https://cloud.githubusercontent.com/assets/306521/24817987/f6e4c30a-1bde-11e7-9f3e-05b7a3f29f18.png)

Check the "Pull request" event in triggers.
![image](https://cloud.githubusercontent.com/assets/306521/24818020/22ce2074-1bdf-11e7-9dac-b19ecd27bc16.png)



## License
bench-bot is available under the [MIT license](https://tldrlegal.com/license/mit-license).

## Contact

Copyright (C) 2017 Icebob

[![@icebob](https://img.shields.io/badge/github-icebob-green.svg)](https://github.com/icebob) [![@icebob](https://img.shields.io/badge/twitter-Icebobcsi-blue.svg)](https://twitter.com/Icebobcsi)
