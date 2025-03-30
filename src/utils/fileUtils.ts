import { workspace, Uri, WorkspaceFolder, FileStat, FileType } from "vscode";
import { Utils } from "vscode-uri";

/**
 * Checks if the file at the given URI exists
 * @param fileUri The file URI to check
 * @returns
 */
export async function fileExists(fileUri: Uri): Promise<boolean> {
	try {
		await workspace.fs.stat(fileUri);
		return true;
	}
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	catch (err) {
		return false;
	}
}

/**
 *
 * @param name
 * @param workingDir
 * @returns Uri | undefined
 */
export async function findUpWorkspaceFile(name: string, workingDir: Uri): Promise<Uri | undefined> {
	let directory: Uri = Utils.dirname(workingDir);
	let count: number = 0;
	const workspaceDir: WorkspaceFolder | undefined = workspace.getWorkspaceFolder(workingDir);
	const removePathEnding: RegExp = /[\\/]$/gi;

	while (directory) {
		const filePath: Uri = Uri.joinPath(directory, name);
		count++;

		try {
			const stats: FileStat = await workspace.fs.stat(filePath);
			if (stats.type === FileType.File) {
				return filePath;
			}
		}
		catch {
			/* empty */
			// break;
		}

		// Stop at the workspace folder
		if (!workspaceDir || count > 20 || directory.fsPath.replace(removePathEnding, "") === workspaceDir.uri.fsPath.replace(removePathEnding, "")) {
			break;
		}

		directory = Utils.joinPath(directory, "../");
	}

	return undefined;
}

/**
 *
 * @param fileUri
 * @returns
 */
export async function readTextFile(fileUri: Uri): Promise<string> {
	const readData = await workspace.fs.readFile(fileUri);
	return Buffer.from(readData).toString("utf8");
}

/**
 *
 * @param fileUri
 * @param fileText
 * @returns
 */
export async function writeTextFile(fileUri: Uri, fileText: string): Promise<void> {
	return workspace.fs.writeFile(fileUri, Buffer.from(fileText));
}
