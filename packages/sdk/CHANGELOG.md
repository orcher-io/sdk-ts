# Changelog

## [0.5.6](https://github.com/orcher-io/sdk-ts/compare/v0.5.5...v0.5.6) (2026-10-11)


### Bug Fixes

* accept heartbeatTimeout on the Task decorator and deprecate heartbeatInterval ([#31](https://github.com/orcher-io/sdk-ts/issues/31)) ([fabf579](https://github.com/orcher-io/sdk-ts/commit/fabf57927b4b1556a3fabcafccfb356342a4ecdd)), closes [#22](https://github.com/orcher-io/sdk-ts/issues/22) [#23](https://github.com/orcher-io/sdk-ts/issues/23)
* pass a single workflow or task input as one argument ([#29](https://github.com/orcher-io/sdk-ts/issues/29)) ([af1c015](https://github.com/orcher-io/sdk-ts/commit/af1c015a2dcf7831e64a4de21eff6ff7e8d026b1)), closes [#20](https://github.com/orcher-io/sdk-ts/issues/20)
* read the task and run ids the native worker sends ([#28](https://github.com/orcher-io/sdk-ts/issues/28)) ([64969ab](https://github.com/orcher-io/sdk-ts/commit/64969ab6e444f7651265cc79c7daeac7017d3b54)), closes [#19](https://github.com/orcher-io/sdk-ts/issues/19)
* register a Workflow class given to the worker under its declared name ([#30](https://github.com/orcher-io/sdk-ts/issues/30)) ([d01898a](https://github.com/orcher-io/sdk-ts/commit/d01898abbd08d54d9cac375509f210d36ccca03f)), closes [#21](https://github.com/orcher-io/sdk-ts/issues/21)

## [0.5.5](https://github.com/orcher-io/sdk-ts/compare/v0.5.4...v0.5.5) (2026-10-09)


### Features

* let a workflow clean up when it is cancelled ([#16](https://github.com/orcher-io/sdk-ts/issues/16)) ([dc6a9e8](https://github.com/orcher-io/sdk-ts/commit/dc6a9e8eb349f6067adde5365195d6359b2e86a5))

## [0.5.4](https://github.com/orcher-io/sdk-ts/compare/v0.5.3...v0.5.4) (2026-10-09)


### Features

* build on orcher-sdk-core 0.10, with a cleanup limit on cancellation ([#14](https://github.com/orcher-io/sdk-ts/issues/14)) ([cf3b8cf](https://github.com/orcher-io/sdk-ts/commit/cf3b8cff41a1589f85dcb92e73e6c0f635eb1046))

## [0.5.3](https://github.com/orcher-io/sdk-ts/compare/v0.5.2...v0.5.3) (2026-10-07)


### Bug Fixes

* say how a workflow ended, type zero-argument actor operations, and close six API gaps ([#10](https://github.com/orcher-io/sdk-ts/issues/10)) ([68065b3](https://github.com/orcher-io/sdk-ts/commit/68065b3ab164fdfee517aa2fb25273225c140d92))

## [0.5.2](https://github.com/orcher-io/sdk-ts/compare/v0.5.1...v0.5.2) (2026-10-05)


### Bug Fixes

* **deps:** build on orcher-sdk-core 0.9.0, which catches code that no longer replays a run ([#9](https://github.com/orcher-io/sdk-ts/issues/9)) ([268e6d3](https://github.com/orcher-io/sdk-ts/commit/268e6d3e6375d6996013f326b12f43ebed4ac715))
* report the steps each activation reached, so sdk-core can catch code that no longer replays a run ([#7](https://github.com/orcher-io/sdk-ts/issues/7)) ([878ae14](https://github.com/orcher-io/sdk-ts/commit/878ae141d6c2ce80bd6c36295095c8ef0b23c9a7))

## [0.5.1](https://github.com/orcher-io/sdk-ts/compare/v0.5.0...v0.5.1) (2026-10-04)


### Bug Fixes

* **deps:** send and receive messages up to 32 MiB with orcher-sdk-core 0.8.1 ([#3](https://github.com/orcher-io/sdk-ts/issues/3)) ([8d37cbc](https://github.com/orcher-io/sdk-ts/commit/8d37cbc74029435650681b76f7c8f21a2146cf8e))

## Changelog
