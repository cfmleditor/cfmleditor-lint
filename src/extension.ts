import { ChildProcess, spawn } from "child_process";
import { some } from "micromatch";
import { lt } from "semver";
import { commands, ConfigurationTarget, Diagnostic, DiagnosticCollection, DocumentFilter, env, ExtensionContext, languages, OpenDialogOptions,
	StatusBarAlignment, StatusBarItem, TextDocument, TextDocumentChangeEvent, TextEditor, Uri, window, workspace, WorkspaceConfiguration, OutputChannel, FileType,
	FileStat } from "vscode";
import CFLintCodeActionProvider from "./codeActions";
import { addConfigRuleExclusion, createCwdConfig, createRootConfig, getConfigFilePath, showActiveConfig, showRootConfig } from "./config";
import { createDiagnostics } from "./diagnostics";
import { CFLintIssueList, CFLintResult } from "./issues";
import { ThrottledDelayer } from "./utils/async";
import { getCurrentDateTimeFormatted } from "./utils/dateUtil";
import { fileExists } from "./utils/fileUtils";
import { Utils } from "vscode-uri";

const jarFilename: string = "cflint-1.5.6-all.jar";
async function activateOctokit() {
	const { Octokit } = await import("@octokit/rest");
	// Your existing code using Octokit
	return new Octokit();
};

const gitRepoInfo = {
	owner: "cflint",
	repo: "CFLint",
};
const httpSuccessStatusCode = 200;

export let extensionContext: ExtensionContext;
export let outputChannel: OutputChannel;

export const LANGUAGE_IDS = ["cfml"];
const DOCUMENT_SELECTOR: DocumentFilter[] = [];
LANGUAGE_IDS.forEach((languageId: string) => {
	DOCUMENT_SELECTOR.push(
		{
			language: languageId,
			scheme: "file",
		}
	);
	DOCUMENT_SELECTOR.push(
		{
			language: languageId,
			scheme: "untitled",
		}
	);
});

const settingsSection = "cflint";
const minimumTypingDelay: number = 200;
const minimumCooldown: number = 500;

let diagnosticCollection: DiagnosticCollection;
let typingDelayer: Map<Uri, ThrottledDelayer<void>>;
let linterCooldowns: Map<Uri, number>;
let runningLints: Map<Uri, ChildProcess>;
let queuedLints: Map<Uri, TextDocument>;
let statusBarItem: StatusBarItem;
let cflintState: State;
let rulesLastRetrieved: Date;

interface RunModes {
	onOpen: boolean;
	onSave: boolean;
	onChange: boolean;
}

enum State {
	Stopped = 0,
	Running = 1,
}

enum OutputFormat {
	Text = "text",
	Html = "html",
	Json = "json",
	Xml = "xml",
}

const minimumCFLintVersion = "1.5.0";
let versionPrompted = false;

/**
 * Checks whether the language id is compatible with CFML.
 * @param languageId The VSCode language id to check.
 * @returns Indication of whether the language id is compatible with CFML.
 */
function isCfmlLanguage(languageId: string): boolean {
	return LANGUAGE_IDS.includes(languageId);
}

/**
 * Enables linter.
 */
function enable(): void {
	if (!workspace.workspaceFolders) {
		window.showErrorMessage("CFLint can only be enabled if VS Code is opened on a workspace folder.");
		return;
	}
	const cflintSettings: WorkspaceConfiguration = getCFLintSettings(window.activeTextEditor?.document.uri);
	cflintSettings.update("enabled", true, ConfigurationTarget.Workspace);
	updateStatusBarItem(window.activeTextEditor);
}

/**
 * Disables linter.
 */
function disable(): void {
	if (!workspace.workspaceFolders) {
		window.showErrorMessage("CFLint can only be disabled if VS Code is opened on a workspace folder.");
		return;
	}
	const cflintSettings: WorkspaceConfiguration = getCFLintSettings(window.activeTextEditor?.document.uri);
	cflintSettings.update("enabled", false, ConfigurationTarget.Workspace);
	updateStatusBarItem(window.activeTextEditor);
}

/**
 * Checks whether the linter is enabled.
 * @param resource The Uri of the document to check against
 * @returns
 */
function isLinterEnabled(resource: Uri): boolean {
	const cflintSettings: WorkspaceConfiguration = getCFLintSettings(resource);
	return cflintSettings.get<boolean>("enabled", true);
}

/**
 * Checks whether the given document matches the set of excluded globs.
 * @param documentUri The URI of the document to check against
 * @returns
 */
function shouldExcludeDocument(documentUri: Uri): boolean {
	const cflintSettings: WorkspaceConfiguration = getCFLintSettings(documentUri);
	const excludeGlobs = cflintSettings.get<string[]>("exclude", []);
	const relativePath = workspace.asRelativePath(documentUri);

	return some(relativePath, excludeGlobs);
}

/**
 * Checks whether the given document should be linted.
 * @param document The document to check against
 * @returns
 */
function shouldLintDocument(document: TextDocument): boolean {
	return isLinterEnabled(document.uri)
		&& isCfmlLanguage(document.languageId)
		&& !shouldExcludeDocument(document.uri)
		&& document.uri.scheme !== "git";
}

/**
 * Checks whether the document is on cooldown.
 * @param document The TextDocument for which to check cooldown status
 * @returns
 */
function isOnCooldown(document: TextDocument): boolean {
	const cflintSettings: WorkspaceConfiguration = getCFLintSettings(document.uri);
	let cooldownSetting: number | undefined = cflintSettings.get<number>("linterCooldown");

	if (cooldownSetting) {
		cooldownSetting = Math.max(cooldownSetting, minimumCooldown);

		const documentCooldown: number | undefined = linterCooldowns.get(document.uri);

		if (documentCooldown && (Date.now() - documentCooldown) < cooldownSetting) {
			return true;
		}
	}

	return false;
}

/**
 * Retrieves VSCode settings for CFLint
 * @param resource The Uri of the document to check against
 * @returns
 */
export function getCFLintSettings(resource: Uri | undefined = undefined): WorkspaceConfiguration {
	return workspace.getConfiguration(settingsSection, resource);
}

/**
 * Gets the proper Java bin name for the platform.
 * @param binName The base name for the bin file
 * @returns The Java bin name for the current platform.
 */
function correctJavaBinName(binName: string): string {
	if (process.platform === "win32") {
		return binName + ".exe";
	}
	else {
		return binName;
	}
}

/**
 * Gets the full path to the java executable to be used.
 * @param resource The URI of the resource for which to check the path
 * @returns The full path to the java executable.
 */
async function findJavaExecutable(resource: Uri): Promise<string> {
	const cflintSettings: WorkspaceConfiguration = getCFLintSettings(resource);
	const javaPath: string | undefined = cflintSettings.get<string | undefined>("javaPath");
	const javaPathSetting: Uri | undefined = javaPath ? Uri.parse(javaPath) : undefined;
	const javaBinName: string = correctJavaBinName("java");

	// Start with setting
	if (javaPathSetting) {
		const checkStats: FileStat = await workspace.fs.stat(javaPathSetting);
		if (checkStats.type === FileType.File && Utils.basename(javaPathSetting) === javaBinName) {
			return javaPathSetting.fsPath;
		}
		else if (checkStats.type === FileType.Directory) {
			const javaPath: Uri = Uri.joinPath(javaPathSetting, javaBinName);
			if (await fileExists(javaPath)) {
				return javaPath.fsPath;
			}
		}

		window.showWarningMessage("Ignoring invalid cflint.javaPath setting. Please correct this.");
	}

	// Check back on "find-java-home" using `allowJre: true`?

	// Then search JAVA_HOME
	const envJavaHome = process.env["JAVA_HOME"];
	if (envJavaHome) {
		const javaPath: Uri = Uri.joinPath(Uri.parse(envJavaHome), "bin", javaBinName);

		if (await fileExists(javaPath)) {
			return javaPath.fsPath;
		}
	}

	// Then search PATH parts
	const envPath = process.env["PATH"];
	if (envPath) {
		const pathParts: string[] = envPath.split(/[:;]/);
		for (const pathPart of pathParts) {
			const javaPath: Uri = Uri.joinPath(Uri.parse(pathPart), javaBinName);
			if (await fileExists(javaPath)) {
				return javaPath.fsPath;
			}
		}
	}

	return javaBinName;
}

/**
 * Checks to see if cflint.jarPath resolves to a valid file path.
 * @param resource The resource for which to check the settings
 * @returns Whether the JAR path in settings is a valid path.
 */
async function jarPathExists(resource: Uri): Promise<boolean> {
	return await getJarUri(resource) !== undefined ? true : false;
}

/**
 * Checks to see if cflint.jarPath resolves to a valid file path.
 * @param resource The resource for which to check the settings
 * @returns Whether the JAR path in settings is a valid path.
 */
async function getJarUri(resource: Uri): Promise<Uri | undefined> {
	const cflintSettings: WorkspaceConfiguration = getCFLintSettings(resource);
	const jarPath: string = cflintSettings.get<string>("jarPath", "");

	try {
		if (jarPath) {
			const jarUri = Uri.file(jarPath);
			if (await validateFileUri(jarUri)) {
				return jarUri;
			}
		}
	}
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	catch (err) { /* empty */ }

	try {
		const jarUri = Uri.joinPath(extensionContext.extensionUri, "resources", jarFilename);
		if (await validateFileUri(jarUri)) {
			return jarUri;
		}
	}
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	catch (err) { /* empty */ }

	return undefined;
}

/**
 * Checks to see if cflint.outputDirectory resolves to a valid directory path.
 * @param resource The resource for which to check the settings
 * @returns Whether the output directory path in settings is a valid path.
 */
async function outputPathExists(resource: Uri): Promise<boolean> {
	const cflintSettings: WorkspaceConfiguration = getCFLintSettings(resource);
	const outputDirectory: string = cflintSettings.get<string>("outputDirectory", "");

	if (!outputDirectory) {
		return false;
	}

	try {
		const outputUri = Uri.file(outputDirectory);
		return await validateDirectoryUri(outputUri) === "";
	}
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	catch (err) {
		return false;
	}
}

/**
 * Checks if the given file URI is valid and exists
 * @param fileUri The URI to check validity.
 * @returns Empty string if valid, else an error message.
 */
async function validateFileUri(fileUri: Uri): Promise<boolean> {
	try {
		if ((await workspace.fs.stat(fileUri)).type === FileType.File) {
			return true;
		}
	}
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	catch (err) {
		// Do nothing
	}

	return false;
}

/**
 * Checks if the given directory file URI is valid and exists
 * @param directoryUri The URI to check validity.
 * @returns Empty string if valid, else an error message.
 */
async function validateDirectoryUri(directoryUri: Uri): Promise<string> {
	try {
		if ((await workspace.fs.stat(directoryUri)).type === FileType.Directory) {
			return "";
		}
	}
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	catch (err) {
		// Do nothing
	}

	return "This is not a valid directory path";
}

/**
 * Displays error message indicating that cflint.jarPath needs to be set to a valid path, and optionally prompts for path.
 * @param resource The resource being linted when this message was generated
 */
function showInvalidJarPathMessage(resource: Uri): void {
	window.showErrorMessage("You must set cflint.jarPath to a valid path in your settings", "Set now").then(
		(selection: string | undefined) => {
			if (selection && selection === "Set now") {
				const cflintSettings: WorkspaceConfiguration = getCFLintSettings(resource);
				const cflintJarPathValues = cflintSettings.inspect<string>("jarPath");
				let configTarget: ConfigurationTarget;
				if (cflintJarPathValues && cflintJarPathValues.workspaceFolderValue) {
					configTarget = ConfigurationTarget.WorkspaceFolder;
				}
				else if (cflintJarPathValues && cflintJarPathValues.workspaceValue) {
					configTarget = ConfigurationTarget.Workspace;
				}
				else {
					configTarget = ConfigurationTarget.Global;
				}
				const jarPath: string = cflintSettings.get<string>("jarPath", "");

				const openDialogOptions: OpenDialogOptions = {
					canSelectFiles: true,
					canSelectFolders: false,
					canSelectMany: false,
					openLabel: "Select",
					filters: { JAR: ["jar"] },
				};

				if (jarPath) {
					try {
						const dirPath: Uri = Uri.parse(jarPath);
						openDialogOptions.defaultUri = dirPath;
					}
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
					catch (err) {
						// noop
					}
				}

				window.showOpenDialog(openDialogOptions).then((uris: Uri[] | undefined) => {
					if (uris?.length === 1) {
						cflintSettings.update("jarPath", uris[0].fsPath, configTarget);
					}
				});
			}
		}
	);
}

/**
 * Displays error message indicating that cflint.outputDirectory needs to be set to a valid directory, and optionally prompts for one.
 * @param resource The resource being linted when this message was generated
 */
function showInvalidOutputDirectoryMessage(resource: Uri): void {
	window.showErrorMessage("You must set cflint.outputDirectory to a valid existing directory in your settings", "Set now").then(
		(selection: string | undefined) => {
			if (selection && selection === "Set now") {
				const cflintSettings: WorkspaceConfiguration = getCFLintSettings(resource);

				const cflintOutputDirValues = cflintSettings.inspect<string>("outputDirectory");
				let configTarget: ConfigurationTarget;
				if (cflintOutputDirValues && cflintOutputDirValues.workspaceFolderValue) {
					configTarget = ConfigurationTarget.WorkspaceFolder;
				}
				else if (cflintOutputDirValues && cflintOutputDirValues.workspaceValue) {
					configTarget = ConfigurationTarget.Workspace;
				}
				else {
					configTarget = ConfigurationTarget.Global;
				}
				const outputDirectory: string = cflintSettings.get<string>("outputDirectory", "");

				const openDialogOptions: OpenDialogOptions = {
					canSelectFiles: false,
					canSelectFolders: true,
					canSelectMany: false,
					openLabel: "Select",
				};

				if (outputDirectory) {
					try {
						const dirPath: Uri = Utils.dirname(Uri.parse(outputDirectory));
						openDialogOptions.defaultUri = dirPath;
					}
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
					catch (err) {
						// noop
					}
				}

				window.showOpenDialog(openDialogOptions).then((uris: Uri[] | undefined) => {
					if (uris?.length === 1) {
						cflintSettings.update("outputDirectory", uris[0].fsPath, configTarget);
					}
				});
			}
		}
	);
}

/**
 * Lints the given document.
 * @param document The document being linted.
 */
async function lintDocument(document: TextDocument): Promise<void> {
	if (!await jarPathExists(document.uri)) {
		showInvalidJarPathMessage(document.uri);
		return;
	}

	if (isOnCooldown(document) || runningLints.has(document.uri) || queuedLints.has(document.uri)) {
		return;
	}

	linterCooldowns.set(document.uri, Date.now());

	const cflintSettings: WorkspaceConfiguration = getCFLintSettings(document.uri);
	const maxSimultaneousLints: number | undefined = cflintSettings.get<number>("maxSimultaneousLints");
	if (maxSimultaneousLints && runningLints.size >= maxSimultaneousLints) {
		queuedLints.set(document.uri, document);
		return;
	}

	await onLintDocument(document);
}

/**
 * Lints the given document, outputting to Diagnostics.
 * @param document The document being linted.
 */
async function onLintDocument(document: TextDocument | undefined): Promise<void> {
	if (!document) {
		return;
	}

	const cflintSettings: WorkspaceConfiguration = getCFLintSettings(document.uri);

	const javaExecutable: string = await findJavaExecutable(document.uri);
	const jarPathUri: Uri | undefined = await getJarUri(document.uri);

	if (!jarPathUri) {
		return;
	}

	const options = workspace.workspaceFolders?.[0] ? { cwd: workspace.workspaceFolders[0].uri.fsPath } : undefined;
	const javaArgs: string[] = [
		"-jar",
		jarPathUri.fsPath,
		"-stdin",
		document.fileName,
		"-q",
		"-e",
		"-json",
		"-stdout",
	];

	const cflintDebug: boolean = cflintSettings.get<boolean>("cflintDebug", false);
	const altConfigFile: string = cflintSettings.get<string>("altConfigFile.path", "");
	if (altConfigFile) {
		const configFile: string | undefined = await getConfigFilePath(document);
		if (configFile) {
			javaArgs.push("-configfile", configFile);
		}
	}

	let output = "";

	try {
		const childProcess: ChildProcess = spawn(javaExecutable, javaArgs, options);
		outputChannel.appendLine(`[${getCurrentDateTimeFormatted()}] ${javaExecutable} ${javaArgs.join(" ")}`);

		if (childProcess.pid && childProcess.stdin && childProcess.stdout) {
			runningLints.set(document.uri, childProcess);
			childProcess.stdin.write(document.getText(), "utf-8");
			childProcess.stdin.end();
			updateState(State.Running);

			childProcess.stdout.on("data", (data: Buffer) => {
				output += data.toString();
			});
			childProcess.stdout.on("end", () => {
				if (output?.length > 0) {
					if (cflintDebug) {
						outputChannel.appendLine(`${output}`);
					}
					void cfLintResult(document, output);
				}
				runningLints.delete(document.uri);
				if (queuedLints.size > 0) {
					const nextKey: Uri | undefined = queuedLints.keys().next().value;
					if (nextKey) {
						void onLintDocument(queuedLints.get(nextKey));
						queuedLints.delete(nextKey);
					}
				}
				if (runningLints.size === 0) {
					updateState(State.Stopped);
				}
			});
		}

		childProcess.on("error", (err: Error) => {
			window.showErrorMessage(`There was a problem with CFLint. ${err.message}`);
			// console.error(`[${getCurrentDateTimeFormatted()}] ${childProcess}`);
			console.error(`[${getCurrentDateTimeFormatted()}] ${err}`);
		});
	}
	catch (err) {
		console.error(err);
	}
}

/**
 * Lints the given document, outputting to a file.
 * @param document The document being linted.
 * @param format The format of the output.
 */
async function outputLintDocument(document: TextDocument, format: OutputFormat = OutputFormat.Html): Promise<void> {
	if (!await jarPathExists(document.uri)) {
		showInvalidJarPathMessage(document.uri);
		return;
	}

	if (!await outputPathExists(document.uri)) {
		showInvalidOutputDirectoryMessage(document.uri);
		return;
	}

	const cflintSettings: WorkspaceConfiguration = getCFLintSettings(document.uri);

	const outputDirectory: string = cflintSettings.get<string>("outputDirectory", "");
	let outputFileName = `cflint-results-${Utils.basename(document.uri)}-${Date.now()}`;

	let fileCommand: string;
	switch (format) {
		case OutputFormat.Text:
			fileCommand = "-textfile";
			outputFileName += ".txt";
			break;
		case OutputFormat.Html:
			fileCommand = "-htmlfile";
			outputFileName += ".html";
			break;
		case OutputFormat.Json:
			fileCommand = "-jsonfile";
			outputFileName += ".json";
			break;
		case OutputFormat.Xml:
			fileCommand = "-xmlfile";
			outputFileName += ".xml";
			break;
		default:
			fileCommand = "-htmlfile";
			outputFileName += ".html";
			break;
	}

	const fullOutputPath: string = Uri.joinPath(Uri.parse(outputDirectory), outputFileName).fsPath;

	const javaExecutable: string = await findJavaExecutable(document.uri);

	const javaArgs: string[] = [
		"-jar",
		cflintSettings.get<string>("jarPath", ""),
		"-stdin",
		document.uri.fsPath,
		"-q",
		"-e",
		`-${format}`,
		fileCommand,
		fullOutputPath,
	];

	const altConfigFile: string = cflintSettings.get<string>("altConfigFile.path", "");
	if (altConfigFile) {
		const configFile: string | undefined = await getConfigFilePath(document);
		if (configFile) {
			javaArgs.push("-configfile", configFile);
		}
	}

	const childProcess: ChildProcess = spawn(javaExecutable, javaArgs);
	outputChannel.appendLine(`[${getCurrentDateTimeFormatted()}] ${javaExecutable} ${javaArgs.join(" ")}`);

	if (childProcess.pid && childProcess.stdin) {
		childProcess.stdin.write(document.getText(), "utf-8");
		childProcess.stdin.end();

		updateState(State.Running);

		childProcess.on("exit", () => {
			if (runningLints.size === 0) {
				updateState(State.Stopped);
			}

			window.showInformationMessage(`Successfully output ${format} file for ${document.fileName}`, "Open").then(
				(selection: string | undefined) => {
					if (selection && selection === "Open") {
						workspace.openTextDocument(Uri.file(fullOutputPath)).then(outputDocument => window.showTextDocument(outputDocument));
					}
				}
			);
		});
	}

	childProcess.on("error", (err: Error) => {
		window.showErrorMessage(`There was a problem with CFLint. ${err.message}`);
		// console.error(`[${getCurrentDateTimeFormatted()}] ${childProcess}`);
		console.error(`[${getCurrentDateTimeFormatted()}] ${err}`);
	});
}

/**
 * Displays a notification message recommending an upgrade of CFLint
 */
function notifyForMinimumVersion(): void {
	window.showErrorMessage(`You must upgrade CFLint to ${minimumCFLintVersion} or higher.`, "Download").then(
		async (selection: string | undefined) => {
			if (selection && selection === "Download") {
				await showCFLintReleases();
			}
		}
	);
}

/**
 * Checks for newer version of CFLint
 * @param currentVersion The current version of CFLint being used
 * @returns
 */

async function checkForLatestRelease(currentVersion: string): Promise<void> {
	const cflintSettings: WorkspaceConfiguration = getCFLintSettings();
	const notifyLatestVersion = cflintSettings.get("notify.latestVersion", true);

	if (!notifyLatestVersion) {
		return Promise.resolve();
	}

	const octokit = await activateOctokit();

	const latestReleaseResult = await octokit.repos.getLatestRelease({ owner: gitRepoInfo.owner, repo: gitRepoInfo.repo });

	if (latestReleaseResult?.status === httpSuccessStatusCode && lt(currentVersion, latestReleaseResult.data.tag_name.replace(/[^\d]*/, ""))) {
		notifyForLatestRelease(latestReleaseResult.data.tag_name);
	}
}

/**
 * Displays a notification message informing of a newer version of CFLint
 * @param tagName The Git tag name for the latest release of CFLint
 */
function notifyForLatestRelease(tagName: string): void {
	// Provide option to disable cflint.notify.latestVersion?
	window.showInformationMessage(`There is a newer release of CFLint available: ${tagName}`, "Download").then(
		async (selection: string | undefined) => {
			if (selection === "Download") {
				await showCFLintReleases();
			}
		}
	);
}

/**
 * Processes CFLint output into Diagnostics
 * @param document Document being linted
 * @param output CFLint JSON output
 */
async function cfLintResult(document: TextDocument, output: string): Promise<void> {
	const parsedOutput: CFLintResult = JSON.parse(output) as CFLintResult;

	if (!versionPrompted) {
		if (!Object.prototype.hasOwnProperty.call(parsedOutput, "version") || lt(parsedOutput.version, minimumCFLintVersion)) {
			notifyForMinimumVersion();
		}
		else {
			const version: string = parsedOutput.version;
			await checkForLatestRelease(version);
		}

		versionPrompted = true;
	}

	const issues: CFLintIssueList[] = parsedOutput.issues;
	let diagnostics: Diagnostic[] = [];
	issues.forEach((issue: CFLintIssueList) => {
		diagnostics = diagnostics.concat(createDiagnostics(document, issue));
	});
	diagnosticCollection.set(document.uri, diagnostics);
}

/**
 * Opens a link that describes the rules.
 * @returns
 */

async function showRuleDocumentation(): Promise<void> {
	const cflintRulesFileName = "RULES.md";
	const cflintRulesUri = Uri.joinPath(extensionContext.extensionUri, "resources", cflintRulesFileName);
	const millisecondsInHour = 3600000;

	if (!rulesLastRetrieved || (Date.now() - rulesLastRetrieved.getTime()) < millisecondsInHour) {
		const octokit = await activateOctokit();

		const cflintRulesResult = await octokit.repos.getContent({
			owner: gitRepoInfo.owner,
			repo: gitRepoInfo.repo,
			path: cflintRulesFileName,
		});

		if (cflintRulesResult?.status === httpSuccessStatusCode && !Array.isArray(cflintRulesResult.data) && cflintRulesResult.data.type === "file") {
			const result = Buffer.from(cflintRulesResult.data["content"], cflintRulesResult.data["encoding"] as BufferEncoding);

			await workspace.fs.writeFile(cflintRulesUri, result);

			rulesLastRetrieved = new Date();
		}
	}

	await commands.executeCommand("markdown.showPreview", cflintRulesUri);
}

/**
 * Opens a link that lists the CFLint releases.
 */
async function showCFLintReleases(): Promise<void> {
	const cflintReleasesURL = "https://github.com/cflint/CFLint/releases";
	const cflintReleasesUri: Uri = Uri.parse(cflintReleasesURL);
	await env.openExternal(cflintReleasesUri);
}

/**
 * Displays or hides CFLint status bar item
 * @param show If true, status bar item is shown, else it's hidden
 */
function showStatusBarItem(show: boolean | undefined): void {
	if (show) {
		statusBarItem.show();
	}
	else {
		statusBarItem.hide();
	}
}

/**
 * Updates the CFLint state
 * @param state enum representing the new state of CFLint
 */
function updateState(state: State): void {
	cflintState = state;
	updateStatusBarItem(window.activeTextEditor);
}

/**
 * Updates CFLint status bar item based on current settings and state
 * @param editor The active text editor
 */
function updateStatusBarItem(editor: TextEditor | undefined): void {
	switch (cflintState) {
		case State.Running:
			statusBarItem.text = "CFLint $(pulse)";
			statusBarItem.tooltip = "Linter is running.";
			break;
		case State.Stopped:
			statusBarItem.text = "CFLint";
			statusBarItem.tooltip = "Linter is stopped.";
			break;
	}

	showStatusBarItem(editor && shouldLintDocument(editor.document));
}

/**
 * Initializes settings helpful to this extension.
 */
function initializeSettings(): void {
	// const fileSettings: WorkspaceConfiguration = workspace.getConfiguration("files", null);
	// const fileAssociations: any | undefined = fileSettings.get("associations", {});

	// if ( fileAssociations ) {
	//     fileAssociations[CONFIG_FILENAME] = "json";
	//     fileSettings.update("associations", fileAssociations, ConfigurationTarget.Global);
	// }
}

/**
 * This method is called when the extension is activated.
 * @param context The context object for this extension.
 */
export function activate(context: ExtensionContext): void {
	console.log(`[${getCurrentDateTimeFormatted()}] cflint is active!`);

	initializeSettings();

	extensionContext = context;
	outputChannel = window.createOutputChannel("CFLint");
	diagnosticCollection = languages.createDiagnosticCollection("cflint");

	typingDelayer = new Map<Uri, ThrottledDelayer<void>>();
	linterCooldowns = new Map<Uri, number>();
	runningLints = new Map<Uri, ChildProcess>();
	queuedLints = new Map<Uri, TextDocument>();

	statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 0);
	statusBarItem.text = "CFLint";

	context.subscriptions.push(diagnosticCollection);
	context.subscriptions.push(statusBarItem);
	context.subscriptions.push(outputChannel);
	context.subscriptions.push(commands.registerCommand("cflint.enable", enable));
	context.subscriptions.push(commands.registerCommand("cflint.disable", disable));
	context.subscriptions.push(commands.registerCommand("cflint.viewRulesDoc", showRuleDocumentation));
	context.subscriptions.push(commands.registerCommand("cflint.createRootConfig", createRootConfig));
	context.subscriptions.push(commands.registerCommand("cflint.createCwdConfig", createCwdConfig));
	context.subscriptions.push(commands.registerCommand("cflint.openRootConfig", showRootConfig));
	context.subscriptions.push(commands.registerTextEditorCommand("cflint.openActiveConfig", (editor: TextEditor) => {
		void showActiveConfig(editor);
	}));

	context.subscriptions.push(commands.registerTextEditorCommand("cflint.runLinter", (editor: TextEditor) => {
		if (!shouldLintDocument(editor.document)) {
			return;
		}

		void lintDocument(editor.document);
	}));

	context.subscriptions.push(commands.registerTextEditorCommand("cflint.outputTextFile", (editor: TextEditor) => {
		void outputLintDocument(editor.document, OutputFormat.Text);
	}));

	context.subscriptions.push(commands.registerTextEditorCommand("cflint.outputHtmlFile", (editor: TextEditor) => {
		void outputLintDocument(editor.document, OutputFormat.Html);
	}));

	context.subscriptions.push(commands.registerTextEditorCommand("cflint.outputJsonFile", (editor: TextEditor) => {
		void outputLintDocument(editor.document, OutputFormat.Json);
	}));

	context.subscriptions.push(commands.registerTextEditorCommand("cflint.outputXmlFile", (editor: TextEditor) => {
		void outputLintDocument(editor.document, OutputFormat.Xml);
	}));

	// TODO: Add command for running linter for all opened CFML files. Needs refactoring. Needs API for opened editors.

	context.subscriptions.push(workspace.onDidOpenTextDocument(async (document: TextDocument) => {
		const cflintSettings: WorkspaceConfiguration = getCFLintSettings(document.uri);
		const runModes: RunModes | undefined = cflintSettings.get("runModes");
		if (!shouldLintDocument(document) || !runModes || !runModes.onOpen) {
			return;
		}

		if (!document.uri.path || (Utils.basename(document.uri) === document.uri.path && !await fileExists(document.uri))) {
			return;
		}

		// TODO: See https://github.com/Microsoft/vscode/issues/15178 for getting opened editors.
		await lintDocument(document);
	}));

	context.subscriptions.push(workspace.onDidSaveTextDocument(async (document: TextDocument) => {
		const cflintSettings: WorkspaceConfiguration = getCFLintSettings(document.uri);
		const runModes: RunModes | undefined = cflintSettings.get("runModes");

		if (!shouldLintDocument(document) || !runModes || !runModes.onSave) {
			return;
		}

		await lintDocument(document);
	}));

	context.subscriptions.push(workspace.onDidChangeTextDocument(async (evt: TextDocumentChangeEvent) => {
		const cflintSettings: WorkspaceConfiguration = getCFLintSettings(evt.document.uri);
		const runModes: RunModes | undefined = cflintSettings.get("runModes");
		if (!shouldLintDocument(evt.document) || !runModes || !runModes.onChange) {
			return;
		}

		let delayer: ThrottledDelayer<void> | undefined = typingDelayer.get(evt.document.uri);
		if (!delayer) {
			let typingDelay: number | undefined;
			try {
				typingDelay = cflintSettings.get<number>("typingDelay");
				if (typingDelay) {
					typingDelay = Math.max(typingDelay, minimumTypingDelay);
				}
				else {
					typingDelay = minimumTypingDelay;
				}
			}
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			catch (err) {
				typingDelay = minimumTypingDelay;
			}
			delayer = new ThrottledDelayer<void>(typingDelay);
			typingDelayer.set(evt.document.uri, delayer);
		}

		await delayer.trigger(async () => {
			await lintDocument(evt.document);
			typingDelayer.delete(evt.document.uri);
		});
	}));

	context.subscriptions.push(workspace.onDidCloseTextDocument((document: TextDocument) => {
		if (!isCfmlLanguage(document.languageId)) {
			return;
		}

		// Exclude files opened by vscode for Git
		if (document.uri.scheme === "git") {
			return;
		}

		// Clear everything for file when closed
		if (document.uri && runningLints.has(document.uri)) {
			const childProcess: ChildProcess | undefined = runningLints.get(document.uri);
			if (childProcess) {
				childProcess.kill();
			}
			runningLints.delete(document.uri);
		}
		diagnosticCollection.delete(document.uri);
		linterCooldowns.delete(document.uri);
		queuedLints.delete(document.uri);

		if (runningLints.size === 0) {
			updateState(State.Stopped);
		}
	}));

	context.subscriptions.push(commands.registerTextEditorCommand("cflint.clearActiveDocumentProblems", (editor: TextEditor) => {
		diagnosticCollection.delete(editor.document.uri);
	}));

	context.subscriptions.push(commands.registerCommand("cflint.clearAllProblems", () => {
		diagnosticCollection.clear();
	}));

	context.subscriptions.push(commands.registerCommand("_cflint.addConfigIgnoreRule", addConfigRuleExclusion));

	context.subscriptions.push(languages.registerCodeActionsProvider(DOCUMENT_SELECTOR, new CFLintCodeActionProvider()));

	context.subscriptions.push(window.onDidChangeActiveTextEditor(updateStatusBarItem));

	updateStatusBarItem(window.activeTextEditor);
}

/**
 * This method is called when the extension is deactivated.
 */
export function deactivate(): void {
}
