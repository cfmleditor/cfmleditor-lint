import { Position, Range, TextDocument, TextEdit, TextLine, WorkspaceEdit } from "vscode";
import { transformTextCase } from "./textUtil";

export interface AutoFix {
	label: string;
	edits: TextEdit[];
}

/**
 * Construct a label for the config exclude rule autofix
 * @param ruleCode The rule code being excluded
 * @returns
 */
export function constructConfigExcludeRuleLabel(ruleCode: string): string {
	return `Exclude rule "${ruleCode}" in .cflintrc`;
}

// Inline Rule Fix
/**
 * Construct a label for the inline ignore rule autofix
 * @param ruleCode The rule code being ignored
 * @param script
 * @returns
 */
export function constructInlineIgnoreRuleLabel(ruleCode: string, script: boolean): string {
	return `Ignore rule "${ruleCode}" for this line ${script ? "(script)" : "(tag)"}`;
}

/**
 * Creates TextEdit for adding an inline ignore rule
 * @param document The document in which the fix will be applied
 * @param range The range for which the fix will be applied
 * @param ruleCode The rule code to be ignored
 * @returns
 */
function createTagInlineIgnoreRuleFix(document: TextDocument, range: Range, ruleCode: string): TextEdit {
	// TODO: Check for an existing ignored rule for this line

	// const isScript: boolean = false; // cfmlApi.getContextUtils().isPositionScript(document, range.start);

	// New position is at the start of the line
	const newPosition: Position = new Position(range.start.line, 0);

	const inlineIgnoreRuleRange: Range = new Range(newPosition, newPosition);
	const inlineIgnoreRuleText: string = `<!--- @CFLintIgnore ${ruleCode} --->\n`;

	// prefix disable comment with same indent as line with the diagnostic
	const ruleLine: TextLine = document.lineAt(range.start.line);

	// Position of the first non white space character on this line
	const prefixIndex: number = ruleLine.firstNonWhitespaceCharacterIndex;

	// Tabs / Spaces at the beginning of the line
	const prefix: string = ruleLine.text.substring(0, prefixIndex);
	const ignoreRuleEdit: TextEdit = new TextEdit(inlineIgnoreRuleRange, prefix + inlineIgnoreRuleText);

	return ignoreRuleEdit;
}

/**
 * Creates TextEdit for adding an inline ignore rule
 * @param document The document in which the fix will be applied
 * @param range The range for which the fix will be applied
 * @param ruleCode The rule code to be ignored
 * @returns
 */
function createScriptInlineIgnoreRuleFix(document: TextDocument, range: Range, ruleCode: string): TextEdit {
	const inlineIgnoreRuleText: string = ` // ignore:${ruleCode}`;

	const ruleLine: TextLine = document.lineAt(range.end.line);
	const inlineIgnoreRuleRange: Range = new Range(ruleLine.range.end, ruleLine.range.end);

	const ignoreRuleEdit: TextEdit = new TextEdit(inlineIgnoreRuleRange, inlineIgnoreRuleText);
	return ignoreRuleEdit;
}

/**
 * Creates workspace edit for adding an inline ignore rule
 * @param document The document in which the fix will be applied
 * @param range The range for which the fix will be applied
 * @param ruleCode The rule code to be ignored
 * @param script
 * @returns
 */
export function createInlineIgnoreRuleEdit(document: TextDocument, range: Range, ruleCode: string, script: boolean): WorkspaceEdit {
	const edit: TextEdit = (script ? createScriptInlineIgnoreRuleFix(document, range, ruleCode) : createTagInlineIgnoreRuleFix(document, range, ruleCode));

	const workspaceEdit: WorkspaceEdit = new WorkspaceEdit();
	workspaceEdit.set(document.uri, [edit]);

	return workspaceEdit;
}

/**
 * Creates workspace edit for transforming the case of a word
 * @param document The document in which the word appears
 * @param range The range of the word
 * @param textCase The text case to use
 * @returns
 */
export function transformCaseRuleEdit(document: TextDocument, range: Range, textCase: string): WorkspaceEdit {
	const currentWord: string = document.getText(range);
	const transformedWord: string = transformTextCase(currentWord, textCase);

	const workspaceEdit: WorkspaceEdit = new WorkspaceEdit();
	workspaceEdit.replace(document.uri, range, transformedWord);

	return workspaceEdit;
}

/**
 * Creates workspace edit for var scoping a variable
 * @param document The document in which the variable is declared
 * @param range The range of the variable identifier
 * @returns
 */
export function varScopeEdit(document: TextDocument, range: Range): WorkspaceEdit {
	const currentWord: string = document.getText(range);
	const varScopedVariable = currentWord === "cfset" ? `${currentWord} var` : `var ${currentWord}`;

	const workspaceEdit: WorkspaceEdit = new WorkspaceEdit();
	workspaceEdit.replace(document.uri, range, varScopedVariable);

	return workspaceEdit;
}

/**
 * Creates workspace edit for local scoping a variable
 * @param document The document in which the variable is declared
 * @param range The range of the variable identifier
 * @returns
 */
export function localScopeEdit(document: TextDocument, range: Range): WorkspaceEdit {
	const currentWord: string = document.getText(range);
	const localScopedVariable = (currentWord === "cfset" ? `${currentWord} local.` : `local.${currentWord}`);

	const workspaceEdit: WorkspaceEdit = new WorkspaceEdit();
	workspaceEdit.replace(document.uri, (currentWord === "cfset"
		? new Range(
				range.start.line,
				range.start.character,
				range.end.line,
				range.end.character + 1
			)
		: range), localScopedVariable);

	return workspaceEdit;
}

// TODO: OUTPUT_ATTR
