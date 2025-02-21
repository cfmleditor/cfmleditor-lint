import { workspace, Uri } from "vscode";

/**
 * Checks if the file at the given URI exists
 * @param fileUri The file URI to check
 * @returns
 */
export async function fileExists(fileUri: Uri): Promise<boolean> {
    try {
        await workspace.fs.stat(fileUri);
        return true;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
        return false;
    }
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
