import * as assert from "assert/strict";
import { extensions } from "vscode";

describe("provideDefinition", function () {
	before(async function () {
	});

	describe("load extension", function () {
		it("extension should exist", function () {
			const extension = extensions.getExtension("cfmleditor.cfmleditor-lint");
			assert.ok(extension);
		});
	});
});
