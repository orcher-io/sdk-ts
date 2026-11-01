# Changelog

## [0.5.17](https://github.com/orcher-io/sdk-ts/compare/v0.5.16...v0.5.17) (2026-11-01)


### Features

* build on orcher-sdk-core 0.23.0 ([#72](https://github.com/orcher-io/sdk-ts/issues/72)) ([edeb293](https://github.com/orcher-io/sdk-ts/commit/edeb293249aa16661ef6776ab81b6ac7ac35e562))

## [0.5.16](https://github.com/orcher-io/sdk-ts/compare/v0.5.15...v0.5.16) (2026-11-01)


### Features

* build on orcher-sdk-core 0.22.1 ([#68](https://github.com/orcher-io/sdk-ts/issues/68)) ([4bfea09](https://github.com/orcher-io/sdk-ts/commit/4bfea092092327be0c1c16884fd232d0e73417e7))


### Changes

* send task heartbeats to the worker host encoded ([#71](https://github.com/orcher-io/sdk-ts/issues/71)) ([bb76d12](https://github.com/orcher-io/sdk-ts/commit/bb76d12b65060ccf7e36172e8168dac7c7e7bec6)), closes [#70](https://github.com/orcher-io/sdk-ts/issues/70)

## [0.5.15](https://github.com/orcher-io/sdk-ts/compare/v0.5.14...v0.5.15) (2026-10-24)


### Features

* run workflows bound to the kernel's step-id scheme ([#66](https://github.com/orcher-io/sdk-ts/issues/66)) ([4a95fc5](https://github.com/orcher-io/sdk-ts/commit/4a95fc5d101b9b597c3fc88c13ec221634250ad2)), closes [#35](https://github.com/orcher-io/sdk-ts/issues/35)

## [0.5.14](https://github.com/orcher-io/sdk-ts/compare/v0.5.13...v0.5.14) (2026-10-24)


### Features

* bound each client call with ClientConfig.timeout ([#63](https://github.com/orcher-io/sdk-ts/issues/63)) ([869da80](https://github.com/orcher-io/sdk-ts/commit/869da80c77934d87aafdd3a5ab413ec7b34bee35))
* make every client call through sdk-core's client protocol ([#65](https://github.com/orcher-io/sdk-ts/issues/65)) ([f8f30ad](https://github.com/orcher-io/sdk-ts/commit/f8f30ad95e8b39c1b46a5e8af70af3d200bbdf3e))

## [0.5.13](https://github.com/orcher-io/sdk-ts/compare/v0.5.12...v0.5.13) (2026-10-23)


### Features

* run on sdk-core 0.20 ([#61](https://github.com/orcher-io/sdk-ts/issues/61)) ([dbb3184](https://github.com/orcher-io/sdk-ts/commit/dbb3184c7db133e5995831c702f408ce0b7ed3a3))

## [0.5.12](https://github.com/orcher-io/sdk-ts/compare/v0.5.11...v0.5.12) (2026-10-21)


### Features

* expose the worker's measurements of the engine wire and its work ([#59](https://github.com/orcher-io/sdk-ts/issues/59)) ([b8206e1](https://github.com/orcher-io/sdk-ts/commit/b8206e1595440606d4240e6901e79fd1835fe5cf))
* move to sdk-core 0.19 ([#60](https://github.com/orcher-io/sdk-ts/issues/60)) ([38fd330](https://github.com/orcher-io/sdk-ts/commit/38fd3308ca0b1ef5ca142e91921f1ddb459a96cc))


### Bug Fixes

* leave a task retry policy's omitted delays to the kernel ([#57](https://github.com/orcher-io/sdk-ts/issues/57)) ([b41f8bc](https://github.com/orcher-io/sdk-ts/commit/b41f8bca0b1c70d9421b1fd87bc3afb5b5b163c0))

## [0.5.11](https://github.com/orcher-io/sdk-ts/compare/v0.5.10...v0.5.11) (2026-10-19)


### Bug Fixes

* mark a workflow failure non-retryable only when its code raised it so ([#54](https://github.com/orcher-io/sdk-ts/issues/54)) ([d22ee37](https://github.com/orcher-io/sdk-ts/commit/d22ee37c3822dbccf0848babff598293bdb0620c))
* send the calls a failing workflow made before it failed ([#56](https://github.com/orcher-io/sdk-ts/issues/56)) ([7ba2e79](https://github.com/orcher-io/sdk-ts/commit/7ba2e798a4ac526a4ddee4c1d4cb5d88c200a9eb))

## [0.5.10](https://github.com/orcher-io/sdk-ts/compare/v0.5.9...v0.5.10) (2026-10-18)


### Features

* let a child workflow and a restart-fresh set their retry policy ([#50](https://github.com/orcher-io/sdk-ts/issues/50)) ([b799d99](https://github.com/orcher-io/sdk-ts/commit/b799d99a5b0c85897b3910175f642977fb2dceac)), closes [#49](https://github.com/orcher-io/sdk-ts/issues/49)

## [0.5.9](https://github.com/orcher-io/sdk-ts/compare/v0.5.8...v0.5.9) (2026-10-17)


### Features

* expose a task failure's error type and whether it was cancelled ([#47](https://github.com/orcher-io/sdk-ts/issues/47)) ([0d8b4ae](https://github.com/orcher-io/sdk-ts/commit/0d8b4aeb79b782d5f87691b34ee024abf95f7d65))


### Bug Fixes

* deliver a cancellation by the kernel's order of outcomes ([#45](https://github.com/orcher-io/sdk-ts/issues/45)) ([d33f115](https://github.com/orcher-io/sdk-ts/commit/d33f11550c0a5177b78865bbb659eaaed7a2d5bc))

## [0.5.8](https://github.com/orcher-io/sdk-ts/compare/v0.5.7...v0.5.8) (2026-10-15)


### Features

* build on sdk-core 0.15 and carry restart timeouts and terminated-child reasons ([#41](https://github.com/orcher-io/sdk-ts/issues/41)) ([0c81187](https://github.com/orcher-io/sdk-ts/commit/0c81187a57d18c5b0aff7dec9e93550549d30211))


### Bug Fixes

* read a workflow run's attempt as the engine numbers it ([#44](https://github.com/orcher-io/sdk-ts/issues/44)) ([18f4af0](https://github.com/orcher-io/sdk-ts/commit/18f4af0dfb083bf44eaf2053d5aaa202b6a95002))
* send the default max attempts when a retry policy omits it ([#46](https://github.com/orcher-io/sdk-ts/issues/46)) ([1760822](https://github.com/orcher-io/sdk-ts/commit/176082207050bf7d9d46b70dbaea5f07d97c76bf))

## [0.5.7](https://github.com/orcher-io/sdk-ts/compare/v0.5.6...v0.5.7) (2026-10-14)


### Features

* run the worker on the shared worker host ([#39](https://github.com/orcher-io/sdk-ts/issues/39)) ([9e7ce19](https://github.com/orcher-io/sdk-ts/commit/9e7ce193c1dc8205974a814235ce12f1095ac156))
* run workflow activations from the kernel protocol ([#37](https://github.com/orcher-io/sdk-ts/issues/37)) ([398b66d](https://github.com/orcher-io/sdk-ts/commit/398b66dc29398c0103d271e3569a3a2602849846))

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
