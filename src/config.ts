import { Position, Range, TextDocument, Uri, window, workspace, WorkspaceConfiguration, WorkspaceEdit, TextEditor } from "vscode";
import { getCFLintSettings } from "./extension";
import { fileExists, findUpWorkspaceFile, writeTextFile } from "./utils/fileUtils";
import { Utils } from "vscode-uri";

export const CONFIG_FILENAME: string = ".cflintrc";

const configFileDefault: string = JSON.stringify(
    {
        "rule": [],
        "excludes": [],
        "includes": [],
        "inheritParent": false,
        "parameters": {}
    },
    null,
    "\t"
);

interface PluginMessage {
    code: string;
    messageText?: string;
    severity?: string;
}

interface RuleParameter {
    name: string;
    value: string;
}

interface Rule {
    name: string;
    className: string;
    message: PluginMessage[];
    parameter: RuleParameter[];
}

interface ConfigParameters {
    [name: string]: string;
}

export interface Config {
    rule?: Rule[];
    excludes?: PluginMessage[];
    includes?: PluginMessage[];
    inheritParent?: boolean;
    parameters?: ConfigParameters;
}

/**
 * Creates a default configuration file in the workspace root path.
 * @param directory The directory in which to create the config file.
 * @returns Indication of whether the file creation was successful.
 */
async function createDefaultConfiguration(directory: Uri): Promise<boolean> {
    if (!directory) {
        window.showErrorMessage("A CFLint configuration can only be generated if VS Code is opened on a workspace folder.");
        return false;
    }

    const cflintConfigFileUri = Uri.joinPath(directory, CONFIG_FILENAME);
    if (!await fileExists(cflintConfigFileUri)) {
        await writeTextFile(cflintConfigFileUri, configFileDefault);
        window.showInformationMessage("Successfully created configuration file", "Open file").then(
            async (selection: string | undefined) => {
                if (selection === "Open file") {
                    const textDocument: TextDocument = await workspace.openTextDocument(cflintConfigFileUri);
                    window.showTextDocument(textDocument);
                }
            }
        );

        return true;
    } else {
        window.showErrorMessage("Configuration file already exists", "Open file").then(
            async (selection: string | undefined) => {
                if (selection && selection === "Open file") {
                    const textDocument: TextDocument = await workspace.openTextDocument(cflintConfigFileUri);
                    window.showTextDocument(textDocument);
                }
            }
        );
    }

    return false;
}

/**
 * Checks to see if an alternate config file exists.
 * @param resource The resource for which to check the settings
 * @returns Whether cflint.altConfigFile resolves to a valid path.
 */
async function alternateConfigFileExists(resource: Uri): Promise<boolean> {
    const cflintSettings: WorkspaceConfiguration = getCFLintSettings(resource);
    const altConfigFilePath: string = cflintSettings.get<string>("altConfigFile.path", "");
    const altConfigFileUri = Uri.file(altConfigFilePath);

    return fileExists(altConfigFileUri);
}

/**
 * Gets the full path to the config file to use for the given document.
 * @param document The document for which the config file will be retrieved.
 * @param fileName The filename that will be checked.
 * @returns The full path to the config file, or undefined if none.
 */
export async function getConfigFilePath(document: TextDocument | undefined, fileName: string = CONFIG_FILENAME): Promise<string | undefined> {

    if ( !document ) {
        return undefined;
    }

    const cflintSettings: WorkspaceConfiguration = getCFLintSettings(document.uri);
    const altConfigFile: string = cflintSettings.get<string>("altConfigFile.path", "");
    const altConfigFileUsage: string = cflintSettings.get<string>("altConfigFile.usage", "fallback");
    const altConfigFileExists: boolean = await alternateConfigFileExists(document.uri);

    if (altConfigFileExists && altConfigFileUsage === "always") {
        return altConfigFile;
    }

    const projectConfig: string | undefined = (await findUpWorkspaceFile(fileName, document.uri))?.fsPath;
    if (projectConfig) {
        return projectConfig;
    }

    if (altConfigFileExists && altConfigFileUsage === "fallback") {
        return altConfigFile;
    }

    return undefined;
}

/**
 * Returns a configuration object for the given configuration document
 * @param configDocument The document for the config file to parse
 * @returns
 */
export function parseConfig(configDocument: TextDocument): Config {
    const parsedConfig: Config = JSON.parse(configDocument.getText()) as Config;
    return parsedConfig;
}

/**
 * Gets the active config document based on the given document
 * @param document The document from which to determine the active config
 * @returns
 */
export async function getActiveConfig(document: TextDocument | undefined = window.activeTextEditor ? window.activeTextEditor.document : undefined): Promise<TextDocument | undefined> {
    const currentConfigPath = await getConfigFilePath(document);
    if (currentConfigPath) {
        return workspace.openTextDocument(currentConfigPath);
    } else {
        return undefined;
    }
}

/**
 * Adds the given rule code as an exclusion to the given document
 * @param document The document for the config file to modify
 * @param ruleCode The rule code to be excluded
 * @returns
 */
export async function addConfigRuleExclusion(document: TextDocument, ruleCode: string): Promise<boolean> {
    const configDocument: TextDocument | undefined = await getActiveConfig(document);

    if (!configDocument) {
        return false;
    }

    const documentText: string = configDocument.getText();
    const parsedConfig: Config = parseConfig(configDocument);

    if (!parsedConfig) {
        return false;
    }

    if (!Object.prototype.hasOwnProperty.call(parsedConfig, "excludes")) {
        parsedConfig.excludes = [];
    }

    const foundExclusion: boolean = parsedConfig.excludes ? parsedConfig.excludes.some((rule) => {
        return (rule?.code === ruleCode);
    }) : false;

    if (foundExclusion) {
        return false;
    }

    let includeIndex = -1;
    if (Object.prototype.hasOwnProperty.call(parsedConfig, "includes") && parsedConfig.includes) {
        includeIndex = parsedConfig.includes.findIndex((rule) => {
            return (rule?.code === ruleCode);
        });
    }

    if (includeIndex !== -1) {
        if ( parsedConfig.includes ) {
            parsedConfig.includes.splice(includeIndex, 1);
        }
    } else {
        if ( parsedConfig.excludes ) {
            parsedConfig.excludes.push(
                {
                    "code": ruleCode
                }
            );
        }
    }

    const edit: WorkspaceEdit = new WorkspaceEdit();
    const documentStart = new Position(0, 0);
    const documentRange = new Range(documentStart, configDocument.positionAt(documentText.length));
    edit.replace(configDocument.uri, documentRange, JSON.stringify(parsedConfig, null, "\t"));

    const success: boolean = await workspace.applyEdit(edit);
    if (success) {
        return configDocument.save();
    }

    return false;
}

/**
 * Creates a config file in the workspace root
 * @param editor The text editor which represents the document for which to create a root config
 * @returns
 */
export async function createRootConfig(editor: TextEditor | undefined = window.activeTextEditor): Promise<boolean> {
    if ( editor ) {
        const workspaceFolder = workspace.getWorkspaceFolder(editor.document.uri);
        if ( workspaceFolder ) {
            return createDefaultConfiguration(workspaceFolder.uri);
        } else {
            return false;
        }
    } else {
        return false;
    }
}

/**
 * Opens the config file in the root
 * @param editor The text editor which represents the document for which to show the root config
 * @returns
 */
export async function showRootConfig(editor: TextEditor | undefined = window.activeTextEditor): Promise<boolean> {

    if ( !editor ) {
        return false;
    }

    const workspaceFolder = workspace.getWorkspaceFolder(editor.document.uri);

    if ( !workspaceFolder ) {
        return false;
    }

    const rootConfigUri = Uri.joinPath(workspaceFolder.uri, CONFIG_FILENAME);

    if (await fileExists(rootConfigUri)) {
        const configDocument: TextDocument = await workspace.openTextDocument(rootConfigUri);
        window.showTextDocument(configDocument);
        return true;
    } else {
        window.showErrorMessage("No config file could be found in the current workspace folder.", "Create Root Config").then(
            async (selection: string | undefined) => {
                if (selection && selection === "Create Root Config") {
                    await createRootConfig(editor);
                }
            }
        );
    }

    return false;
}

/**
 * Shows the active config document
 * @param editor The text editor which represents the document for which to show the config in the current working directory
 * @returns
 */
export async function showActiveConfig(editor: TextEditor | undefined = window.activeTextEditor): Promise<boolean> {

    if (!editor) {
        return false;
    }

    const configDocument: TextDocument | undefined = await getActiveConfig(editor.document);

    if (!configDocument) {
        window.showErrorMessage("No config file is being used for the currently active document.", "Create Root Config").then(
            async (selection: string | undefined) => {
                if (selection && selection === "Create Root Config") {
                    await createRootConfig(editor);
                }
            }
        );

        return false;
    }

    window.showTextDocument(configDocument);

    return true;
}

/**
 * Creates a config file in the current working directory
 * @param editor The text editor which represents the document for which to create a config in the current working directory
 * @returns
 */
export async function createCwdConfig(editor: TextEditor | undefined = window.activeTextEditor): Promise<boolean> {
    if ( editor ) {
        const directory = Utils.dirname(editor.document.uri);
        return createDefaultConfiguration(directory);
    } else {
         return false;
    }
}
