# Change Log

All notable changes to the VS Code cfmleditor-lint extension will be documented in this file.

## [0.4.16] - 2025-07-31

- Add CFLint quick fix settings to enable / disable some of the quick fix options
- Add CFLint quick fix that adds line based ignore comments ( seperate for script and tag, somewhat experimental )
- Add ability to use `Manually run CFLint on current workspace` with a file glob.

## [0.4.15] - 2025-07-30

- Update packages / dependencies

## [0.4.14] - 2025-06-29

- Update packages / dependencies

## [0.4.12] - 2025-04-06

- Lower VSCode minimum version to `1.96.0` to support Cursor

## [0.4.11] - 2025-03-31

- Fix potential infinite loop when trying to find a .cflintrc file ( where one doesn't exist )

## [0.4.10] - 2025-03-31

- Prevent spawn process locking up VSCode waiting for promise during CFLint / Java failure

## [0.4.9] - 2025-03-21

- Package CFMLEditor version of CFLint.jar with extension

## [0.4.8] - 2025-03-11

- Implement initial Unit tests
- Various lint rule / code base improvements
- Update packages / dependencies

## [0.4.7] - 2025-02-25

- Package extension using esbuild to fix issues with ESM vs CJS
- Update octokit/rest package

## [0.4.6] - 2025-02-21

- Update packages
- Update lint / fix lint rules

## [0.4.5] - 2024-09-18

- Fix 'Update Dependencies' regression

## [0.4.4] - 2024-09-02

- Update Dependencies

## [0.3.6] - 2022-04-16

- Add Workspace Trust support

## [0.3.5] - 2022-04-07

- Utilize output channel
- Allowed `cflint.javaPath` setting to be directory instead of just file path
- Changed path configuration scopes to be `machine-overridable`
- Restricted display of commands with `when` clauses
- Fixed possible issue when not also using `KamasamaK.vscode-cfml` extension
- Added Codicons for commands
- Migrate TSLint to ESLint

## [0.3.4] - 2019-07-08

- Updated usage for setting `cflint.exclude` to use glob relative to the workspace folder
- Set `isPreferred` for preferred code actions

## [0.3.3] - 2019-02-21

- Replaced deprecated use of `Buffer`
- Moved ignore code actions below fixes
- Added setting `cflint.exclude` to exclude specified globs from linting

## [0.3.2] - 2019-01-14

- Reverted non-working check for workspace scan
- Added some checks for `undefined` before use

## [0.3.1] - 2018-12-17

- Improved rule retrieval to only fetch online at most once per hour
- Missing or invalid path settings now prompt with an open dialog instead of asking for the path to be written out
- Replaced some `require` with ES6 imports
- Updated launch configuration
- Added separate `compile` script
- Added check to prevent linting on open event when entire workspace is being scanned by CFML extension
- Updated TypeScript to 3.2.2

## [0.3.0] - 2018-10-22

- Added code actions for ignoring rules in `.cflintrc`, transforming variable case, and var/local scoping
- Updated `.cflintrc` schema
- Now only explicitly uses `-configfile` when altConfigFile.path is valid
- Added CFLint version check and notifies if below minimum or latest version
- Added `DiagnosticTag.Unnecessary` to diagnostics for `UNUSED_LOCAL_VARIABLE`
- Removed issue ID/code from message
- Updated TypeScript to 3.1.3
- Updated Tasks to 2.0.0

## [0.2.4] - 2017-11-27

- Added commands to output results to a file.
- Added new tsconfig options

## [0.2.3] - 2017-11-03

- Updated engine and dependencies
- Fixed a configuration setting
- Changed tsconfig options
- Updated tslint rule
- Added "Open File" option when creating a config file that already exists
- Replaced some `Thenable`s with async/await

## [0.2.2] - 2017-10-02

- Added `cflint.maxSimultaneousLints` setting along with the feature it controls, which queues any lints that exceed that number.

## [0.2.1] - 2017-10-01

- Removed extension dependency
- Made some commands asynchronous
- Added type casting to configuration retrieval
- Changed configuration update to use `ConfigurationTarget`
- Added extension recommendations for extension developers and updated dependencies

## [0.2.0] - 2017-08-15

- Added status bar indicator
- Prevent overlapping linting for a file
- Added better error messaging
- Added new commands for clearing problems
- Replaced deprecated variable due to introduction of multi-root workspaces
- Updated dependencies

## [0.1.2] - 2017-08-02

- Removed unnecessary dependency
- Improved README

## [0.1.1] - 2017-07-31

- Added new error message when opening config file that does not exist
- Improved README

## [0.1.0] - 2017-07-29

- Initial release
