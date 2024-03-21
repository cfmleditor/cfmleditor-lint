import { workspace, Uri, FileStat } from "vscode";
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
    } catch (err) {
        return false;
    }
}


/**
 *
 * @param path file path
 * @param ext
 * @returns string
 */
export function resolveBaseName(path: string, ext?: string): string {
    let base = Utils.basename(Uri.parse(path));
    if (ext) {
        base = base.replace(ext, '');
    }
    return base;
}


/**
 *
 * @param path file path
 * @param ext
 * @returns string
 */
export function uriBaseName(path: Uri, ext?: string): string {
    let base = Utils.basename(path);
    if (ext) {
        base = base.replace(ext, '');
    }
    return base;
}

/**
 *
 * @param path file path
 * @returns Promise
 */
export async function uriExists(path: Uri): Promise<boolean> {
    try {
        await workspace.fs.stat(path);
        return true;
    } catch {
        return false;
    }
}

/**
 *
 * @param path file path
 * @returns Promise
 */
export async function uriStat(path: Uri): Promise<FileStat> {
    return await workspace.fs.stat(path);
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
